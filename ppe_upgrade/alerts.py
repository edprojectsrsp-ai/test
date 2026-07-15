"""alerts.py — violation alert dispatcher with cooldowns.

Called by the existing violation engine after temporal smoothing confirms a
violation:   dispatcher.fire(camera="gate-2", violation="NO_helmet",
                             snapshot_path=..., meta={...})

Features:
  * Cooldown per (camera, violation) — default 300s — so one worker without a
    helmet generates one alert, not four hundred.
  * Channels: webhook (any JSON receiver / n8n / Telegram bridge),
    WhatsApp Cloud API (Meta), SMTP email. All optional, config via env or
    constructor. Failures never block the detection loop (worker thread +
    bounded queue, drop-oldest under pressure).
  * Every fire() is returned with its routing decision so the caller can log
    to Postgres for the compliance audit trail.
"""
from __future__ import annotations

import json
import os
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class AlertConfig:
    cooldown_s: float = 300.0
    webhook_url: Optional[str] = os.environ.get("PPE_ALERT_WEBHOOK") or None
    whatsapp_token: Optional[str] = os.environ.get("WHATSAPP_TOKEN") or None
    whatsapp_phone_id: Optional[str] = os.environ.get("WHATSAPP_PHONE_ID") or None
    whatsapp_to: List[str] = field(default_factory=lambda: [
        n for n in (os.environ.get("PPE_ALERT_WHATSAPP_TO") or "").split(",") if n])
    smtp_host: Optional[str] = os.environ.get("PPE_SMTP_HOST") or None
    smtp_port: int = int(os.environ.get("PPE_SMTP_PORT") or 587)
    smtp_user: Optional[str] = os.environ.get("PPE_SMTP_USER") or None
    smtp_password: Optional[str] = os.environ.get("PPE_SMTP_PASSWORD") or None
    email_to: List[str] = field(default_factory=lambda: [
        e for e in (os.environ.get("PPE_ALERT_EMAIL_TO") or "").split(",") if e])
    queue_size: int = 200


class AlertDispatcher:
    def __init__(self, cfg: Optional[AlertConfig] = None, start_worker: bool = True):
        self.cfg = cfg or AlertConfig()
        self._last: Dict[Tuple[str, str], float] = {}
        self._q: "queue.Queue[dict]" = queue.Queue(maxsize=self.cfg.queue_size)
        self._worker: Optional[threading.Thread] = None
        if start_worker:
            self._worker = threading.Thread(target=self._run, daemon=True)
            self._worker.start()

    # ---- public API -------------------------------------------------------
    def fire(self, camera: str, violation: str, snapshot_path: Optional[str] = None,
             meta: Optional[dict] = None, now: Optional[float] = None) -> dict:
        """Returns {'sent': bool, 'suppressed_by_cooldown': bool, 'remaining_s': float}."""
        now = time.time() if now is None else now
        key = (camera, violation)
        elapsed = now - self._last.get(key, 0.0)
        if elapsed < self.cfg.cooldown_s:
            return {"sent": False, "suppressed_by_cooldown": True,
                    "remaining_s": round(self.cfg.cooldown_s - elapsed, 1)}
        self._last[key] = now
        payload = {
            "event": "ppe_violation", "camera": camera, "violation": violation,
            "snapshot": snapshot_path, "at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now)),
            "meta": meta or {},
        }
        try:
            self._q.put_nowait(payload)
        except queue.Full:
            try:
                self._q.get_nowait()          # drop oldest under pressure
                self._q.put_nowait(payload)
            except queue.Empty:
                pass
        return {"sent": True, "suppressed_by_cooldown": False, "remaining_s": 0.0}

    def reset_cooldown(self, camera: Optional[str] = None) -> None:
        if camera is None:
            self._last.clear()
        else:
            for k in [k for k in self._last if k[0] == camera]:
                del self._last[k]

    # ---- worker -----------------------------------------------------------
    def _run(self) -> None:
        while True:
            payload = self._q.get()
            for send in (self._send_webhook, self._send_whatsapp, self._send_email):
                try:
                    send(payload)
                except Exception:
                    pass  # a broken channel must never kill the worker

    def _send_webhook(self, payload: dict) -> None:
        if not self.cfg.webhook_url:
            return
        import urllib.request
        req = urllib.request.Request(
            self.cfg.webhook_url, data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=8)

    def _send_whatsapp(self, payload: dict) -> None:
        if not (self.cfg.whatsapp_token and self.cfg.whatsapp_phone_id and self.cfg.whatsapp_to):
            return
        import urllib.request
        text = (f"⚠️ PPE VIOLATION — {payload['violation']}\n"
                f"Camera: {payload['camera']}\nTime: {payload['at']}")
        for to in self.cfg.whatsapp_to:
            body = {"messaging_product": "whatsapp", "to": to,
                    "type": "text", "text": {"body": text}}
            req = urllib.request.Request(
                f"https://graph.facebook.com/v20.0/{self.cfg.whatsapp_phone_id}/messages",
                data=json.dumps(body).encode(),
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {self.cfg.whatsapp_token}"},
                method="POST")
            urllib.request.urlopen(req, timeout=10)

    def _send_email(self, payload: dict) -> None:
        if not (self.cfg.smtp_host and self.cfg.email_to):
            return
        import smtplib
        from email.message import EmailMessage
        msg = EmailMessage()
        msg["Subject"] = f"PPE violation: {payload['violation']} @ {payload['camera']}"
        msg["From"] = self.cfg.smtp_user or "ppe@project-brain.local"
        msg["To"] = ", ".join(self.cfg.email_to)
        msg.set_content(json.dumps(payload, indent=2))
        if payload.get("snapshot") and os.path.exists(payload["snapshot"]):
            with open(payload["snapshot"], "rb") as f:
                msg.add_attachment(f.read(), maintype="image", subtype="jpeg",
                                   filename=os.path.basename(payload["snapshot"]))
        with smtplib.SMTP(self.cfg.smtp_host, self.cfg.smtp_port, timeout=15) as s:
            s.starttls()
            if self.cfg.smtp_user:
                s.login(self.cfg.smtp_user, self.cfg.smtp_password or "")
            s.send_message(msg)
