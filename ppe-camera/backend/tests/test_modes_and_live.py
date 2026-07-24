"""
Verifies the v2 upgrade layer end-to-end (standalone, like the other tests):
  1. mode switching: off -> no inference; monitor -> violations only;
     collect -> violations + uncertainty harvest (fired=None sink calls)
  2. live view: workers publish annotated frames; snapshot + mode + flag routes
  3. alert cooldown: one alert per (camera, gear) per window
  4. models registry API: list / activate / rollback with detector hot-swap stub
Run:  python tests/test_modes_and_live.py
"""
import sys, os, time, tempfile, asyncio
sys.path.insert(0, '.')
tmp = tempfile.mkdtemp()
os.environ['PPE_ROOT'] = tmp
os.environ['PPE_DATABASE_URL'] = f'sqlite+aiosqlite:///{tmp}/modes.db'
os.environ['PPE_ALERT_COOLDOWN'] = '60'

import numpy as np
from app.ml.detector import Detection, FrameResult
from app.services.camera_manager import CameraConfig, CameraManager
from app.services.sources import FakeSource


def frame_result(w=640, h=480, dets=()):
    fr = FrameResult(width=w, height=h)
    fr.detections.extend(dets)
    return fr


def uncertain_det(i):
    return Detection(cls_name='helmet', raw_name='hardhat', confidence=0.40,
                     xyxy=(10 + i, 10, 80 + i, 90), track_id=1)


# ---- 1) modes --------------------------------------------------------------
calls = {'detect': 0, 'violation': 0, 'uncertain': 0}

def make_detect(uncertain=True):
    def _d(frame):
        calls['detect'] += 1
        return frame_result(dets=[uncertain_det(calls['detect'])] if uncertain else [])
    return _d

def sink(camera_id, frame, result, fired):
    if fired is None:
        calls['uncertain'] += 1
    else:
        calls['violation'] += 1
    return True

# make the sampler permissive for the test (no interval / dedupe barriers)
from app.services.uncertainty import get_sampler
s = get_sampler()
s.min_interval_s = 0.0
s.phash_min_distance = 0
s.max_per_hour = 1000

mgr = CameraManager(detect_fn=make_detect(), capture_sink=sink)

# off: source runs, zero inference
cfg_off = CameraConfig(camera_id='c-off', source_kind='fake',
                       source_kwargs={'frames': 8}, mode='off', fps_limit=0)
mgr.add(cfg_off, source=FakeSource(frames=8))
mgr.start('c-off'); time.sleep(0.5); mgr.stop('c-off')
assert calls['detect'] == 0, calls
print('off mode: 0 inferences over 8 frames  OK')

# collect: uncertainty harvest fires (fired=None path)
cfg_col = CameraConfig(camera_id='c-col', source_kind='fake',
                       source_kwargs={'frames': 6}, mode='collect', fps_limit=0)
mgr.add(cfg_col, source=FakeSource(frames=6))
mgr.start('c-col'); time.sleep(0.8); mgr.stop('c-col')
assert calls['detect'] > 0 and calls['uncertain'] > 0, calls
st = mgr.status('c-col')
assert st['mode'] == 'collect' and st['stats']['captures_made'] == calls['uncertain'] + calls['violation']
print(f"collect mode: {calls['detect']} inferences, {calls['uncertain']} uncertainty harvests  OK")

# monitor: same detections, NO uncertainty harvest
before = calls['uncertain']
cfg_mon = CameraConfig(camera_id='c-mon', source_kind='fake',
                       source_kwargs={'frames': 6}, mode='monitor', fps_limit=0)
mgr.add(cfg_mon, source=FakeSource(frames=6))
mgr.start('c-mon'); time.sleep(0.8); mgr.stop('c-mon')
assert calls['uncertain'] == before, calls
print('monitor mode: 0 new harvests  OK')

# live mode switch on a worker
w = mgr.add(CameraConfig(camera_id='c-sw', source_kind='fake', mode='monitor'),
            source=FakeSource(frames=2))
assert mgr.set_mode('c-sw', 'strict') == 'strict' and w.config.mode == 'strict'
try:
    mgr.set_mode('c-sw', 'bogus'); raise SystemExit('accepted bogus mode')
except ValueError:
    print('mode validation rejects bogus  OK')

# ---- 2) live view publish + routes ----------------------------------------
from app.services import live_view
img = np.zeros((120, 160, 3), dtype=np.uint8); img[:, :80] = (0, 0, 200)
live_view.publish('c-live', img, {'mode': 'monitor'})
assert live_view.latest('c-live') and live_view.latest('c-live')[:2] == b'\xff\xd8'
annotated = live_view.draw_overlay(img, frame_result(dets=[uncertain_det(0)]), 'collect', 'c-live')
assert annotated.shape == img.shape
print('live view: publish->jpeg + overlay draw  OK')

# ---- 3) alert dedup ---------------------------------------------------------
# Deduplication is now per person rather than per (camera, gear): the same
# worker stays quiet, but a second worker must still get through.
from app.services.alert_service import AlertService
from app.services.alert_policy import get_policy_engine
al = AlertService(start_worker=False)
get_policy_engine().reset()
t0 = 5000.0
assert al.fire('gate', 'helmet', now=t0, person='t1')['sent']
r = al.fire('gate', 'helmet', now=t0 + 10, person='t1')
assert r['suppressed'] and r['remaining_s'] > 0
assert al.fire('gate', 'helmet', now=t0 + 10, person='t2')['sent'], \
    'a different person must not be suppressed by the first one'
get_policy_engine().reset()
assert al.fire('gate', 'vest', now=t0 + 10)['sent']
assert al.fire('gate', 'helmet', now=t0 + 61)['sent']
print('alerts: cooldown suppress / per-gear / expiry  OK')

# ---- 4) API: mode + snapshot + models registry ------------------------------
from httpx import AsyncClient, ASGITransport
from app.main import app

async def api():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://t') as c:
        from app.core.db import init_db
        await init_db()

        # snapshot of the published live frame
        r = await c.get('/api/cameras/c-live/snapshot.jpg')
        assert r.status_code == 200 and r.headers['content-type'] == 'image/jpeg'

        # mode endpoint against a registered camera
        from app.services import runtime
        runtime._manager = mgr  # use our test manager
        r = await c.post('/api/cameras/c-sw/mode', json={'mode': 'collect'})
        assert r.status_code == 200 and r.json()['mode'] == 'collect'
        r = await c.post('/api/cameras/nope/mode', json={'mode': 'off'})
        assert r.status_code == 404
        r = await c.post('/api/cameras/c-sw/mode', json={'mode': 'nah'})
        assert r.status_code == 422
        print('API: snapshot + mode endpoints  OK')

        # models registry: seed two fake versions, activate + rollback
        import json as _json
        from app.core.config import get_settings
        s = get_settings()
        s.WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
        w1 = s.WEIGHTS_DIR / 'v1.pt'; w1.write_bytes(b'w1')
        w2 = s.WEIGHTS_DIR / 'v2.pt'; w2.write_bytes(b'w2')
        reg = {'versions': [
            {'version': 1, 'weights': str(w1), 'note': 'seed', 'ts': time.time()},
            {'version': 2, 'weights': str(w2), 'note': 'retrain+38 reviewed', 'ts': time.time()},
        ], 'active': None}
        (s.WEIGHTS_DIR / 'registry.json').write_text(_json.dumps(reg))

        # stub detector reload so we don't pull ultralytics
        from app.ml import detector as det_mod
        det_mod.Detector.reload = lambda self: None
        det_mod.Detector._instance = det_mod.Detector()

        r = await c.get('/api/models')
        assert r.status_code == 200 and len(r.json()['versions']) == 2

        r = await c.post('/api/models/2/activate')
        assert r.status_code == 200 and r.json()['active'] == 2
        active_file = s.WEIGHTS_DIR / s.ACTIVE_WEIGHTS_NAME
        assert active_file.read_bytes() == b'w2'

        r = await c.post('/api/models/rollback')
        assert r.status_code == 200 and r.json()['active'] == 1
        assert active_file.read_bytes() == b'w1'
        print('API: models list/activate/rollback with weight hot-swap  OK')

asyncio.run(api())
print()
print('=== MODES + LIVE VIEW + ALERTS + MODEL REGISTRY VERIFIED ===')
