"""WhatsApp channel tests.

WhatsApp was a stripped-down copy of the Telegram path: text only, env-only
config, its own thinner message, and no per-recipient isolation — so the first
unreachable number aborted the send and every later supervisor heard nothing.
"""
from __future__ import annotations

import json
import os
import tempfile

import pytest

os.environ.setdefault("PPE_ROOT", tempfile.mkdtemp())

from app.services import alert_config as ac
from app.services.alert_service import AlertService


@pytest.fixture(autouse=True)
def _isolated_config(tmp_path, monkeypatch):
    """Give each test its own alert_config.json.

    Settings.DATA_DIR is evaluated at class-definition time, so setting
    PPE_ROOT has no effect on where the config is written no matter how many
    caches are cleared — every test was in fact sharing one file, and only
    ordering kept that from showing. Pointing _config_path at tmp_path is the
    reliable isolation.
    """
    monkeypatch.setattr(ac, "_config_path",
                        lambda: tmp_path / "alert_config.json")
    ac.invalidate()
    yield
    ac.invalidate()


def configure(**kw):
    base = dict(whatsapp_enabled=True, whatsapp_token="TOK",
                whatsapp_phone_id="PID", whatsapp_to="+911111111111")
    base.update(kw)
    ac.update(base)


def capture(monkeypatch, fail_for=(), upload_id="MEDIA1"):
    sent = []

    class Resp:
        def __init__(self, body): self._b = body
        def read(self): return self._b
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake(req, timeout=None):
        url = req.full_url
        if url.endswith("/media"):
            return Resp(json.dumps({"id": upload_id}).encode())
        body = json.loads(req.data)
        if body.get("to") in fail_for:
            raise OSError("recipient not in 24h window")
        sent.append(body)
        return Resp(b'{"messages":[{"id":"wamid.X"}]}')

    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", fake)
    return sent


def violation(snapshot=None, gear="NO_HELMET"):
    return {"violation": gear, "camera": "gate", "at": "2026-07-24 10:00:00",
            "meta": {"identity": "t7", "evidence_frames": 6, "zone": "welding bay"},
            "snapshot": snapshot}


class TestRecipientIsolation:
    """The bug: one loop with no isolation meant that when the first number
    failed, supervisors two and three never heard about the violation."""

    def test_remaining_numbers_still_receive(self, monkeypatch):
        sent = capture(monkeypatch, fail_for={"+911111111111"})
        configure(whatsapp_to="+911111111111,+922222222222,+933333333333")
        AlertService(start_worker=False)._whatsapp(violation())
        assert [m["to"] for m in sent] == ["+922222222222", "+933333333333"]

    def test_all_numbers_receive_when_healthy(self, monkeypatch):
        sent = capture(monkeypatch)
        configure(whatsapp_to="+911111111111,+922222222222")
        AlertService(start_worker=False)._whatsapp(violation())
        assert len(sent) == 2


class TestMessageParity:
    def test_carries_the_same_detail_as_other_channels(self, monkeypatch):
        """A thinner WhatsApp body would drop the zone and evidence count that
        make an alert actionable."""
        sent = capture(monkeypatch)
        configure()
        AlertService(start_worker=False)._whatsapp(violation())
        text = sent[0]["text"]["body"]
        assert "NO_HELMET" in text and "gate" in text
        assert "t7" in text and "6 frames" in text

    def test_markdown_is_stripped(self, monkeypatch):
        """WhatsApp renders asterisks literally, so Telegram's bold markers
        would show up as punctuation."""
        sent = capture(monkeypatch)
        configure()
        AlertService(start_worker=False)._whatsapp(violation())
        assert "*" not in sent[0]["text"]["body"]


class TestPhotoEvidence:
    def test_the_snapshot_is_uploaded_and_sent_as_an_image(self, monkeypatch, tmp_path):
        """A text saying 'no helmet on camera 7' leaves a supervisor with
        nothing to act on or dispute."""
        snap = tmp_path / "frame.jpg"
        snap.write_bytes(b"\xff\xd8\xff\xe0FAKEJPEG")
        sent = capture(monkeypatch)
        configure()
        AlertService(start_worker=False)._whatsapp(violation(str(snap)))
        assert sent[0]["type"] == "image"
        assert sent[0]["image"]["id"] == "MEDIA1"
        assert "NO_HELMET" in sent[0]["image"]["caption"]

    def test_a_failed_upload_falls_back_to_text(self, monkeypatch, tmp_path):
        """Sending nothing because the photo failed would be worse than
        sending the words."""
        snap = tmp_path / "frame.jpg"
        snap.write_bytes(b"\xff\xd8\xff\xe0X")
        sent = []

        class Resp:
            def read(self): return b'{"messages":[]}'
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake(req, timeout=None):
            if req.full_url.endswith("/media"):
                raise OSError("upload rejected")
            sent.append(json.loads(req.data))
            return Resp()

        import urllib.request
        monkeypatch.setattr(urllib.request, "urlopen", fake)
        configure()
        AlertService(start_worker=False)._whatsapp(violation(str(snap)))
        assert sent and sent[0]["type"] == "text"

    def test_photo_can_be_turned_off(self, monkeypatch, tmp_path):
        snap = tmp_path / "f.jpg"
        snap.write_bytes(b"\xff\xd8X")
        sent = capture(monkeypatch)
        configure(whatsapp_send_photo=False)
        AlertService(start_worker=False)._whatsapp(violation(str(snap)))
        assert sent[0]["type"] == "text"


class TestTemplateWindow:
    def test_a_configured_template_is_used_when_there_is_no_photo(self, monkeypatch):
        """Outside Meta's 24-hour window free text is silently rejected, so a
        template is the only thing that reaches a supervisor overnight."""
        sent = capture(monkeypatch)
        configure(whatsapp_template="ppe_violation", whatsapp_template_lang="en")
        AlertService(start_worker=False)._whatsapp(violation())
        assert sent[0]["type"] == "template"
        assert sent[0]["template"]["name"] == "ppe_violation"
        assert sent[0]["template"]["language"]["code"] == "en"

    def test_plain_text_when_no_template_is_configured(self, monkeypatch):
        sent = capture(monkeypatch)
        configure()
        AlertService(start_worker=False)._whatsapp(violation())
        assert sent[0]["type"] == "text"


class TestGuards:
    def test_disabled_sends_nothing(self, monkeypatch):
        sent = capture(monkeypatch)
        configure(whatsapp_enabled=False)
        AlertService(start_worker=False)._whatsapp(violation())
        assert sent == []

    def test_incomplete_credentials_send_nothing(self, monkeypatch):
        sent = capture(monkeypatch)
        configure(whatsapp_phone_id="")
        AlertService(start_worker=False)._whatsapp(violation())
        assert sent == []

    def test_gear_filter_limits_what_is_sent(self, monkeypatch):
        sent = capture(monkeypatch)
        configure(whatsapp_gear_filter=["NO_HELMET"])
        svc = AlertService(start_worker=False)
        svc._whatsapp(violation(gear="NO_VEST"))
        assert sent == []
        svc._whatsapp(violation(gear="NO_HELMET"))
        assert len(sent) == 1


class TestConfigStore:
    def test_token_is_masked_for_the_browser(self):
        ac.update({"whatsapp_token": "EAAG1234567890abcdef"})
        masked = ac.masked()
        assert masked["whatsapp_token"] != "EAAG1234567890abcdef"
        assert masked["whatsapp_token_set"] is True

    def test_blank_token_does_not_clear_the_stored_one(self):
        ac.update({"whatsapp_token": "SECRET"})
        ac.update({"whatsapp_token": ""})
        assert ac.get("whatsapp_token") == "SECRET"

    def test_readiness_requires_every_part(self):
        assert ac.whatsapp_ready() is False
        configure()
        assert ac.whatsapp_ready() is True
        ac.update({"whatsapp_to": ""})
        assert ac.whatsapp_ready() is False

    def test_numbers_parse_from_a_comma_list(self):
        configure(whatsapp_to=" +91111 , +92222 ,, ")
        assert ac.whatsapp_numbers() == ["+91111", "+92222"]

    def test_env_still_works_for_existing_deployments(self, monkeypatch):
        """Installations configured only through .env must keep working."""
        monkeypatch.setenv("WHATSAPP_TOKEN", "FROM_ENV")
        ac.invalidate()
        assert ac.get("whatsapp_token") == "FROM_ENV"

    def test_runtime_config_overrides_env(self, monkeypatch):
        monkeypatch.setenv("WHATSAPP_TOKEN", "FROM_ENV")
        ac.invalidate()
        ac.update({"whatsapp_token": "FROM_UI"})
        assert ac.get("whatsapp_token") == "FROM_UI"
