"""
Alert service -- external notifications when a violation is confirmed.

fire() is called by the camera worker AFTER the violation engine's temporal
smoothing, gated per (camera_id, gear) by ALERT_COOLDOWN_S so one helmet-less
worker produces one WhatsApp message, not four hundred. Delivery happens on a
daemon worker thread behind a bounded queue (drop-oldest under pressure) so a
dead SMTP server can never stall the detection loop. Channels are optional and
env-configured:

  Telegram                   configured from the UI (Settings tab) and stored in
                             alert_config.json; falls back to PPE_TELEGRAM_* env
  PPE_ALERT_WEBHOOK          any JSON receiver (n8n / Telegram bridge / Brain)
  WHATSAPP_TOKEN + WHATSAPP_PHONE_ID + PPE_ALERT_WHATSAPP_TO (comma list)
  PPE_SMTP_HOST/PORT/USER/PASSWORD + PPE_ALERT_EMAIL_TO (comma list)

fire() returns the routing decision (sent / suppressed / remaining_s) so the
caller can log it to the compliance audit trail.
"""
from __future__ import annotations

import json
import os
import queue
import threading
import time

from app.core.config import get_settings


class AlertService:
    def __init__(self, start_worker: bool = True) -> None:
        self._cooldown_default = float(get_settings().ALERT_COOLDOWN_S)
        self._last: dict[tuple[str, str], float] = {}
        self._q: "queue.Queue[dict]" = queue.Queue(maxsize=200)
        self._worker: threading.Thread | None = None
        if start_worker:
            self._worker = threading.Thread(target=self._run, name="ppe-alerts", daemon=True)
            self._worker.start()

    @property
    def cooldown_s(self) -> float:
        """Live-read so changing it in the UI takes effect without a restart."""
        try:
            from app.services import alert_config
            return float(alert_config.get("cooldown_s") or self._cooldown_default)
        except Exception:
            return self._cooldown_default

    # ---- public ------------------------------------------------------------
    def fire(self, camera_id: str, gear: str, snapshot_path: str | None = None,
             meta: dict | None = None, now: float | None = None,
             person: str | None = None) -> dict:
        """Queue an alert if policy allows.

        Deduplication is per *person*, not per (camera, gear). The old key
        meant ten bare-headed workers on one camera produced a single alert
        and nine genuine violations were dropped, while one worker walking in
        and out of frame could re-alert indefinitely.
        """
        now = time.time() if now is None else now
        meta = dict(meta or {})
        person = person or meta.get("identity") or (
            f"t{meta['track_id']}" if meta.get("track_id") is not None else None)

        from app.services.alert_policy import get_policy_engine
        decision = get_policy_engine().evaluate(camera_id, gear, person, now=now)
        self._maybe_send_digest(now)
        if not decision.send:
            return decision.as_dict()

        meta.update({"incident": decision.incident_key,
                     "occurrence": decision.occurrence,
                     "escalation": decision.escalation_level})
        prefix = "ESCALATION — " if decision.kind == "escalation" else ""
        payload = {
            "event": "ppe_violation",
            "camera": camera_id,
            "violation": prefix + (f"NO_{gear}" if not gear.startswith("NO_") else gear),
            "snapshot": snapshot_path,
            "at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now)),
            "meta": meta,
        }
        try:
            self._q.put_nowait(payload)
        except queue.Full:
            try:
                self._q.get_nowait()
                self._q.put_nowait(payload)
            except queue.Empty:
                pass
        return decision.as_dict()

    def _maybe_send_digest(self, now: float) -> None:
        """Flush the suppressed-alert digest when its window closes.

        Without this, everything the rate limiter held back would vanish and a
        chaotic shift would look quieter than a calm one.
        """
        from app.services.alert_policy import get_policy_engine
        engine = get_policy_engine()
        if not engine.digest_due(now):
            return
        d = engine.take_digest(now)
        if not d:
            return
        lines = [f"\u2022 {cam}: " + ", ".join(f"{g} \u00d7{n}" for g, n in gears.items())
                 for cam, gears in d["by_camera"].items()]
        payload = {
            "event": "ppe_digest",
            "camera": "(digest)",
            "violation": (f"{d['suppressed_count']} further violations suppressed "
                          f"({d['distinct_people']} people) {d['from']}\u2013{d['to']}"),
            "snapshot": None,
            "at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now)),
            "meta": {"digest": True, "detail": "\n".join(lines)},
        }
        try:
            self._q.put_nowait(payload)
        except queue.Full:
            pass

    def reset(self, camera_id: str | None = None) -> None:
        if camera_id is None:
            self._last.clear()
        else:
            for k in [k for k in self._last if k[0] == camera_id]:
                del self._last[k]

    # ---- delivery worker -----------------------------------------------------
    def _run(self) -> None:
        while True:
            payload = self._q.get()
            for send in (self._telegram, self._webhook, self._whatsapp, self._email):
                try:
                    send(payload)
                except Exception:
                    pass  # one broken channel must never kill the worker

    # ---- telegram ------------------------------------------------------------
    @staticmethod
    def format_message(payload: dict) -> str:
        """Human-readable alert text, shared by live alerts and the test button."""
        meta = payload.get("meta") or {}
        lines = [
            f"\u26a0\ufe0f *PPE VIOLATION* \u2014 {payload.get('violation', 'UNKNOWN')}",
            f"Camera: {payload.get('camera', '-')}",
            f"Time: {payload.get('at', '-')}",
        ]
        if meta.get("location"):
            lines.append(f"Location: {meta['location']}")
        if meta.get("confidence") is not None:
            try:
                lines.append(f"Confidence: {float(meta['confidence']):.0%}")
            except (TypeError, ValueError):
                pass
        if meta.get("identity"):
            lines.append(f"Person: {meta['identity']}")
        elif meta.get("track_id") is not None:
            lines.append(f"Track: {meta['track_id']}")
        if meta.get("evidence_frames"):
            lines.append(f"Evidence: {meta['evidence_frames']} frames")
        if meta.get("occurrence", 0) > 1:
            lines.append(f"Occurrence: {meta['occurrence']} in this incident")
        if meta.get("escalation"):
            lines.append(f"Escalation level {meta['escalation']} \u2014 not yet corrected")
        if meta.get("detail"):
            lines.append("")
            lines.append(str(meta["detail"]))
        return "\n".join(lines)

    def _telegram(self, payload: dict) -> None:
        """Send to Telegram. Photo evidence when we have a snapshot on disk."""
        from app.services import alert_config

        if not alert_config.telegram_ready():
            return
        gear_filter = alert_config.get("telegram_gear_filter") or []
        if gear_filter and payload.get("violation") not in gear_filter:
            return

        token = str(alert_config.get("telegram_bot_token"))
        text = self.format_message(payload)
        snapshot = payload.get("snapshot")
        want_photo = bool(alert_config.get("telegram_send_photo"))
        has_photo = bool(snapshot and os.path.exists(snapshot)) and want_photo

        for chat_id in alert_config.chat_ids():
            try:
                if has_photo:
                    self._telegram_photo(token, chat_id, text, snapshot)
                else:
                    self._telegram_text(token, chat_id, text)
            except Exception:
                # one bad chat id must not stop the others
                continue

    @staticmethod
    def _telegram_text(token: str, chat_id: str, text: str) -> dict:
        import urllib.request

        body = json.dumps({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
            "disable_web_page_preview": True,
        }).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=body, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode() or "{}")

    @staticmethod
    def _telegram_photo(token: str, chat_id: str, caption: str, path: str) -> dict:
        """multipart/form-data upload -- stdlib only, no requests dependency."""
        import mimetypes
        import urllib.request
        import uuid

        boundary = uuid.uuid4().hex
        with open(path, "rb") as fh:
            image = fh.read()
        filename = os.path.basename(path)
        mime = mimetypes.guess_type(filename)[0] or "image/jpeg"

        parts: list[bytes] = []
        for field, value in (("chat_id", chat_id), ("caption", caption[:1024]),
                             ("parse_mode", "Markdown")):
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"\r\n\r\n"
                f"{value}\r\n".encode())
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; "
            f"filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n".encode())
        parts.append(image)
        parts.append(f"\r\n--{boundary}--\r\n".encode())
        body = b"".join(parts)

        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendPhoto",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST")
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode() or "{}")

    def _webhook(self, payload: dict) -> None:
        url = os.getenv("PPE_ALERT_WEBHOOK")
        if not url:
            return
        import urllib.request

        req = urllib.request.Request(
            url, data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=8)

    def _whatsapp(self, payload: dict) -> None:
        token = os.getenv("WHATSAPP_TOKEN")
        phone_id = os.getenv("WHATSAPP_PHONE_ID")
        to_list = [n for n in (os.getenv("PPE_ALERT_WHATSAPP_TO") or "").split(",") if n]
        if not (token and phone_id and to_list):
            return
        import urllib.request

        text = (f"⚠️ PPE VIOLATION — {payload['violation']}\n"
                f"Camera: {payload['camera']}\nTime: {payload['at']}")
        for to in to_list:
            body = {"messaging_product": "whatsapp", "to": to,
                    "type": "text", "text": {"body": text}}
            req = urllib.request.Request(
                f"https://graph.facebook.com/v20.0/{phone_id}/messages",
                data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {token}"},
                method="POST")
            urllib.request.urlopen(req, timeout=10)

    def _email(self, payload: dict) -> None:
        host = os.getenv("PPE_SMTP_HOST")
        to_list = [e for e in (os.getenv("PPE_ALERT_EMAIL_TO") or "").split(",") if e]
        if not (host and to_list):
            return
        import smtplib
        from email.message import EmailMessage

        msg = EmailMessage()
        msg["Subject"] = f"PPE violation: {payload['violation']} @ {payload['camera']}"
        msg["From"] = os.getenv("PPE_SMTP_USER", "ppe@project-brain.local")
        msg["To"] = ", ".join(to_list)
        msg.set_content(json.dumps(payload, indent=2))
        snap = payload.get("snapshot")
        if snap and os.path.exists(snap):
            with open(snap, "rb") as f:
                msg.add_attachment(f.read(), maintype="image", subtype="jpeg",
                                   filename=os.path.basename(snap))
        with smtplib.SMTP(host, int(os.getenv("PPE_SMTP_PORT", "587")), timeout=15) as s:
            s.starttls()
            user = os.getenv("PPE_SMTP_USER")
            if user:
                s.login(user, os.getenv("PPE_SMTP_PASSWORD", ""))
            s.send_message(msg)


_service: AlertService | None = None


def get_alert_service() -> AlertService:
    global _service
    if _service is None:
        _service = AlertService()
    return _service
