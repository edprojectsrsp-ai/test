"""Camera config must survive a restart.

CameraRecord carried the docstring "the CameraManager rehydrates these at
startup so cameras no longer vanish on restart", and upsert_camera/all_cameras
were both written — but neither was ever called. Adding twenty cameras and
restarting lost all twenty, along with every zone mask and tuned threshold.
"""
from __future__ import annotations

import os
import tempfile

import pytest
import pytest_asyncio

os.environ.setdefault("PPE_ROOT", tempfile.mkdtemp())

from app.ml.detector import FrameResult
from app.services.camera_manager import CameraConfig, CameraManager
from app.services.camera_store import (config_to_row, restore_fleet,
                                       row_to_config, save_camera)


def _manager() -> CameraManager:
    return CameraManager(detect_fn=lambda f: FrameResult(width=64, height=48),
                         capture_sink=lambda *a, **k: False)


def _config(**kw) -> CameraConfig:
    base = dict(camera_id="cam1", source_kind="rtsp",
                source_kwargs={"url": "rtsp://host/1"},
                required_ppe={"helmet"}, fps_limit=6.0)
    base.update(kw)
    return CameraConfig(**base)


@pytest.fixture(autouse=True)
def _db(tmp_path, monkeypatch):
    monkeypatch.setenv("PPE_ROOT", str(tmp_path))
    yield


class TestSerialisation:
    def test_round_trips_without_loss(self):
        cfg = _config(source_kind="mjpeg",
                      source_kwargs={"url": "http://ip/video.cgi", "username": "a"},
                      required_ppe={"helmet", "goggles"}, fps_limit=4.0,
                      priority="critical",
                      monitoring_zones=[{"name": "road", "kind": "exclude",
                                         "points": [[0.5, 0], [1, 0], [1, 1]]}])
        row = config_to_row(cfg)

        class Row:
            id = "cam1"
        for k, v in row.items():
            setattr(Row, k, v)
        back = row_to_config(Row)

        assert back.source_kind == "mjpeg"
        assert back.source_kwargs["url"] == "http://ip/video.cgi"
        assert back.required_ppe == {"helmet", "goggles"}
        assert back.fps_limit == 4.0
        assert back.priority == "critical"
        assert back.monitoring_zones[0]["name"] == "road"

    def test_ppe_set_survives_the_json_trip(self):
        """A set cannot be stored as JSON, so it is written sorted and read
        back as a set — a silent list would break membership tests."""
        row = config_to_row(_config(required_ppe={"vest", "helmet"}))
        assert row["required_ppe"] == ["helmet", "vest"]

    def test_missing_new_columns_fall_back_to_defaults(self):
        """A database not yet migrated must still restore its cameras."""
        class OldRow:
            id = "cam1"
            source_kind = "rtsp"
            source_kwargs = {"url": "rtsp://host/1"}
            required_ppe = ["helmet"]
            zones = []
            fps_limit = 6.0
            # monitoring_zones, detection_rule and priority absent
        cfg = row_to_config(OldRow)
        assert cfg.monitoring_zones == [] and cfg.priority == "normal"

    def test_empty_ppe_falls_back_rather_than_monitoring_nothing(self):
        class Row:
            id = "cam1"
            source_kind = "rtsp"
            source_kwargs = {}
            required_ppe = []
            zones = []
            fps_limit = 6.0
        assert row_to_config(Row).required_ppe == {"helmet", "vest"}


class TestFailureHandling:
    def test_saving_never_raises(self):
        """An operator who has just masked a public road cares that the mask is
        live; losing the durable copy is the lesser failure and must not take
        the camera off the air."""
        from app.services.camera_store import save_camera_sync
        save_camera_sync("cam1", _config())          # no event loop running

    @pytest.mark.asyncio
    async def test_save_returns_false_instead_of_raising(self, monkeypatch):
        import app.services.camera_store as cs
        monkeypatch.setattr(cs, "config_to_row",
                            lambda c: (_ for _ in ()).throw(RuntimeError("boom")))
        assert await save_camera("cam1", _config()) is False

    @pytest.mark.asyncio
    async def test_restore_survives_an_unreadable_database(self, monkeypatch):
        import app.services.persistence as p
        monkeypatch.setattr(p, "get_persistence_service",
                            lambda: (_ for _ in ()).throw(RuntimeError("no db")))
        result = await restore_fleet(_manager())
        assert result["restored"] == [] and "error" in result

    @pytest.mark.asyncio
    async def test_one_bad_row_does_not_block_the_other_cameras(self, monkeypatch):
        """After a power cut, nineteen cameras must come back even if the
        twentieth row is corrupt."""
        class Good:
            id = "good"
            source_kind = "fake"
            source_kwargs = {"frames": 1}
            required_ppe = ["helmet"]
            zones = []
            monitoring_zones = []
            detection_rule = {}
            fps_limit = 6.0
            priority = "normal"
            mode = "monitor"

        class Bad(Good):
            id = "bad"
            source_kind = None
            source_kwargs = None

        import app.services.camera_store as cs

        class FakeSvc:
            async def all_cameras(self, session):
                return [Bad, Good]

        class FakeSession:
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False

        monkeypatch.setattr("app.core.db.SessionLocal", lambda: FakeSession())
        monkeypatch.setattr("app.services.persistence.get_persistence_service",
                            lambda: FakeSvc())

        def boom(row):
            if row.id == "bad":
                raise ValueError("corrupt row")
            return _config(camera_id=row.id, source_kind="fake",
                           source_kwargs={"frames": 1})

        monkeypatch.setattr(cs, "row_to_config", boom)

        m = _manager()
        result = await restore_fleet(m)
        assert result["restored"] == ["good"]
        assert [f["camera_id"] for f in result["failed"]] == ["bad"]
        m.stop_all()


class TestEndToEnd:
    @pytest.mark.asyncio
    async def test_a_full_config_survives_a_restart(self):
        from app.core.db import init_db
        await init_db()

        m1 = _manager()
        cfg = _config(camera_id="gate-01", source_kind="mjpeg",
                      source_kwargs={"url": "http://10.0.0.5/video.cgi"},
                      required_ppe={"helmet", "vest"}, fps_limit=4.0,
                      priority="critical",
                      monitoring_zones=[{"name": "public road", "kind": "exclude",
                                         "points": [[0.6, 0], [1, 0], [1, 1], [0.6, 1]]}])
        w = m1.add(cfg, persist=False)
        w.set_detection_rule({"min_person_px": 24, "min_frames": 7})
        await save_camera("gate-01", w.config,
                          detection_rule=w.get_detection_rule(), mode=w.config.mode)

        # a brand-new manager knows nothing — this is the restart
        m2 = _manager()
        assert m2.list_status() == []
        result = await restore_fleet(m2)
        assert result["restored"] == ["gate-01"]

        w2 = m2._get("gate-01")
        rule = w2.get_detection_rule()
        assert w2.config.source_kind == "mjpeg"
        assert w2.config.priority == "critical"
        assert rule["min_person_px"] == 24 and rule["min_frames"] == 7
        assert [z["name"] for z in w2.config.monitoring_zones] == ["public road"]
        # and the mask is actually armed, not merely stored
        assert w2._engine.rule.zones is not None
        m2.stop_all()

    @pytest.mark.asyncio
    async def test_zone_edits_are_persisted_as_they_are_made(self):
        from app.core.db import init_db
        await init_db()

        m1 = _manager()
        w = m1.add(_config(camera_id="cam-z", source_kind="fake",
                           source_kwargs={"frames": 1}), persist=False)
        w.set_monitoring_zones([{"name": "bay", "kind": "include",
                                 "points": [[0, 0], [0.5, 0], [0.5, 1]]}])
        await save_camera("cam-z", w.config,
                          detection_rule=w.get_detection_rule(), mode=w.config.mode)

        m2 = _manager()
        await restore_fleet(m2)
        assert [z["name"] for z in m2._get("cam-z").config.monitoring_zones] == ["bay"]
        m2.stop_all()
