"""
Alert service -- external notifications when a violation is confirmed.

fire() is called by the camera worker AFTER the violation engine's temporal
smoothing, gated per (camera_id, gear) by ALERT_COOLDOWN_S so one helmet-less
worker produces one WhatsApp message, not four hundred. Delivery happens on a
daemon worker thread behind a bounded queue (drop-oldest under pressure) so a
dead SMTP server can never stall the detection loop. Channels are optional and
env-configured:

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
        self.cooldown_s = float(get_settings().ALERT_COOLDOWN_S)
        self._last: dict[tuple[str, str], float] = {}
        self._q: "queue.Queue[dict]" = queue.Queue(maxsize=200)
        self._worker: threading.Thread | None = None
        if start_worker:
            self._worker = threading.Thread(target=self._run, name="ppe-alerts", daemon=True)
            self._worker.start()

    # ---- public ------------------------------------------------------------
    def fire(self, camera_id: str, gear: str, snapshot_path: str | None = None,
             meta: dict | None = None, now: float | None = None) -> dict:
        now = time.time() if now is None else now
        key = (camera_id, gear)
        elapsed = now - self._last.get(key, 0.0)
        if elapsed < self.cooldown_s:
            return {"sent": False, "suppressed": True,
                    "remaining_s": round(self.cooldown_s - elapsed, 1)}
        self._last[key] = now
        payload = {
            "event": "ppe_violation",
            "camera": camera_id,
            "violation": f"NO_{gear}" if not gear.startswith("NO_") else gear,
            "snapshot": snapshot_path,
            "at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now)),
            "meta": meta or {},
        }
        try:
            self._q.put_nowait(payload)
        except queue.Full:
            try:
                self._q.get_nowait()
                self._q.put_nowait(payload)
            except queue.Empty:
                pass
        return {"sent": True, "suppressed": False, "remaining_s": 0.0}

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
            for send in (self._webhook, self._whatsapp, self._email):
                try:
                    send(payload)
                except Exception:
                    pass  # one broken channel must never kill the worker

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
