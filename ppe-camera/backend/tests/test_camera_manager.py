import sys, time
sys.path.insert(0, '.')
from app.ml.detector import Detection, FrameResult
from app.services.sources import FakeSource, build_source
from app.services.camera_manager import CameraManager, CameraConfig, CameraState

# --- injected detector: simulate a person with NO helmet on every frame ---
def fake_detect(frame):
    fr = FrameResult(width=64, height=48)
    fr.detections = [
        Detection('person','person',0.9,(10,5,50,45),track_id=1),
        Detection('no_helmet','no-hardhat',0.8,(20,5,40,15),track_id=None),
    ]
    return fr

# --- capture sink: record calls ---
captured = []
def sink(camera_id, frame, result, fired):
    captured.append((camera_id, fired.gear, fired.track_id))
    return True  # pretend we saved it

def test_source_factory():
    s = build_source('fake', frames=3)
    assert isinstance(s, FakeSource)
    s.open()
    n = 0
    while s.read() is not None:
        n += 1
    assert n == 3, f"expected 3 frames got {n}"
    s.close()
    print('source factory OK (fake emitted 3 frames)')

def test_unknown_source():
    try:
        build_source('quantum')
        assert False
    except ValueError as e:
        print('unknown source rejected:', e)

def test_lifecycle_and_pipeline():
    mgr = CameraManager(detect_fn=fake_detect, capture_sink=sink)
    cfg = CameraConfig(
        camera_id='cam-A', source_kind='fake',
        source_kwargs={'frames': 10}, required_ppe={'helmet'},
        fps_limit=0,  # no throttle so every frame infers in the test
    )
    # inject a fake source directly for determinism
    worker = mgr.add(cfg, source=FakeSource(frames=10))
    assert worker.state == CameraState.created
    print('state after add:', worker.state.value)

    mgr.start('cam-A')
    # wait for the worker to drain 10 frames and stop
    for _ in range(50):
        if worker.state in (CameraState.stopped, CameraState.error):
            break
        time.sleep(0.05)
    print('state after run:', worker.state.value, '| stats:', vars(worker.stats))
    assert worker.state == CameraState.stopped, worker.stats.last_error
    assert worker.stats.frames_read == 10
    assert worker.stats.frames_inferred == 10
    # helmet violation needs min_frames(5) sustained -> should fire once ~frame 5
    assert worker.stats.violations_fired >= 1, "violation should fire"
    assert worker.stats.captures_made >= 1
    assert captured[0] == ('cam-A', 'helmet', 1)
    print('violations fired:', worker.stats.violations_fired, '| captured:', captured[:2])

def test_add_start_stop_remove():
    mgr = CameraManager(detect_fn=fake_detect, capture_sink=sink)
    cfg = CameraConfig(camera_id='cam-B', source_kind='fake', required_ppe={'vest'})
    # long-running source so we can stop mid-flight
    class Endless(FakeSource):
        def read(self):
            import numpy as np
            time.sleep(0.01)
            return np.zeros((48,64,3), dtype='uint8')
    mgr.add(cfg, source=Endless())
    mgr.start('cam-B')
    time.sleep(0.2)
    st = mgr.status('cam-B')
    assert st['state'] == 'running', st
    print('mid-flight state:', st['state'], '| frames:', st['stats']['frames_read'])
    mgr.stop('cam-B')
    assert mgr.status('cam-B')['state'] == 'stopped'
    print('after stop:', mgr.status('cam-B')['state'])
    # duplicate add rejected
    try:
        mgr.add(cfg)
        assert False
    except ValueError as e:
        print('duplicate add rejected:', e)
    mgr.remove('cam-B')
    try:
        mgr.status('cam-B')
        assert False
    except KeyError:
        print('removed OK (status now KeyError)')

def test_multi_camera():
    mgr = CameraManager(detect_fn=fake_detect, capture_sink=sink)
    for i in range(3):
        mgr.add(CameraConfig(camera_id=f'm{i}', source_kind='fake',
                             source_kwargs={'frames':6}, fps_limit=0),
                source=FakeSource(frames=6))
        mgr.start(f'm{i}')
    for _ in range(50):
        states = [s['state'] for s in mgr.list_status()]
        if all(s in ('stopped','error') for s in states):
            break
        time.sleep(0.05)
    statuses = mgr.list_status()
    print('multi-cam final states:', [s['state'] for s in statuses])
    assert all(s['state']=='stopped' for s in statuses)
    assert len(statuses) == 3
    print('3 concurrent cameras ran and stopped cleanly')

test_source_factory()
test_unknown_source()
test_lifecycle_and_pipeline()
test_add_start_stop_remove()
test_multi_camera()
print('\n=== CAMERA MANAGER + PIPELINE VERIFIED ===')

