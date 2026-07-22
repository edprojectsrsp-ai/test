"""Tests for the Telegram alert channel and its runtime config store."""
from __future__ import annotations

import json
import os
import tempfile

import pytest

os.environ.setdefault("PPE_ROOT", tempfile.mkdtemp())

from app.services import alert_config as ac
from app.services.alert_service import AlertService


@pytest.fixture(autouse=True)
def clean_config(tmp_path, monkeypatch):
    monkeypatch.setenv("PPE_ROOT", str(tmp_path))
    from app.core.config import get_settings
    get_settings.cache_clear()
    ac.invalidate()
    yield
    ac.invalidate()


def test_disabled_by_default():
    assert ac.telegram_ready() is False


def test_update_and_ready():
    ac.update({"telegram_enabled": True, "telegram_bot_token": "1:AAA",
               "telegram_chat_ids": "-100,7"})
    assert ac.telegram_ready() is True
    assert ac.chat_ids() == ["-100", "7"]


def test_blank_token_does_not_clear_stored_secret():
    ac.update({"telegram_bot_token": "1:SECRET"})
    ac.update({"telegram_bot_token": ""})
    assert ac.get("telegram_bot_token") == "1:SECRET"


def test_token_is_masked_for_the_browser():
    ac.update({"telegram_bot_token": "123456:ABCDEFGHIJKLMNOP"})
    masked = ac.masked()
    assert masked["telegram_bot_token"] != "123456:ABCDEFGHIJKLMNOP"
    assert masked["telegram_bot_token_set"] is True


def test_cooldown_is_live_editable():
    svc = AlertService(start_worker=False)
    ac.update({"cooldown_s": 5})
    assert svc.cooldown_s == 5.0


def test_cooldown_suppresses_duplicate_violations():
    svc = AlertService(start_worker=False)
    ac.update({"cooldown_s": 60})
    assert svc.fire("CAM1", "HELMET")["sent"] is True
    second = svc.fire("CAM1", "HELMET")
    assert second["sent"] is False and second["suppressed"] is True
    # a different camera is a different key, so it still fires
    assert svc.fire("CAM2", "HELMET")["sent"] is True


def test_message_format_includes_context():
    text = AlertService.format_message({
        "violation": "NO_HELMET", "camera": "BF5-GATE", "at": "2026-07-22 10:00:00",
        "meta": {"confidence": 0.91, "location": "Blast Furnace 5"},
    })
    assert "NO_HELMET" in text and "BF5-GATE" in text
    assert "91%" in text and "Blast Furnace 5" in text


def _capture(monkeypatch):
    sent = []

    class FakeResp:
        def read(self): return b'{"ok":true,"result":{}}'
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake_urlopen(req, timeout=None):
        sent.append({"url": req.full_url, "ctype": req.headers.get("Content-type"),
                     "body": req.data})
        return FakeResp()

    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    return sent


def test_sends_text_to_every_chat(monkeypatch):
    sent = _capture(monkeypatch)
    ac.update({"telegram_enabled": True, "telegram_bot_token": "TOK",
               "telegram_chat_ids": "-100,7"})
    AlertService(start_worker=False)._telegram(
        {"violation": "NO_HELMET", "camera": "C1", "at": "now", "meta": {}, "snapshot": None})
    assert len(sent) == 2
    assert sent[0]["url"].endswith("/sendMessage")
    assert json.loads(sent[0]["body"])["chat_id"] == "-100"


def test_sends_photo_when_snapshot_exists(monkeypatch, tmp_path):
    sent = _capture(monkeypatch)
    snap = tmp_path / "frame.jpg"
    snap.write_bytes(b"\xff\xd8\xff\xe0FAKEJPEG")
    ac.update({"telegram_enabled": True, "telegram_bot_token": "TOK",
               "telegram_chat_ids": "-100", "telegram_send_photo": True})
    AlertService(start_worker=False)._telegram(
        {"violation": "NO_VEST", "camera": "C2", "at": "now", "meta": {},
         "snapshot": str(snap)})
    assert sent[0]["url"].endswith("/sendPhoto")
    assert sent[0]["ctype"].startswith("multipart/form-data; boundary=")
    assert b"FAKEJPEG" in sent[0]["body"]


def test_gear_filter_limits_notifications(monkeypatch):
    sent = _capture(monkeypatch)
    ac.update({"telegram_enabled": True, "telegram_bot_token": "TOK",
               "telegram_chat_ids": "-100", "telegram_gear_filter": ["NO_HELMET"]})
    svc = AlertService(start_worker=False)
    svc._telegram({"violation": "NO_VEST", "camera": "C", "at": "n", "meta": {}, "snapshot": None})
    assert sent == []
    svc._telegram({"violation": "NO_HELMET", "camera": "C", "at": "n", "meta": {}, "snapshot": None})
    assert len(sent) == 1


def test_nothing_sent_when_disabled(monkeypatch):
    sent = _capture(monkeypatch)
    ac.update({"telegram_enabled": False, "telegram_bot_token": "TOK",
               "telegram_chat_ids": "-100"})
    AlertService(start_worker=False)._telegram(
        {"violation": "NO_HELMET", "camera": "C", "at": "n", "meta": {}, "snapshot": None})
    assert sent == []
