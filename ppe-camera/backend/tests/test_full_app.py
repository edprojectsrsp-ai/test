import sys, asyncio, tempfile, os, time
sys.path.insert(0, '.')
tmp = tempfile.mkdtemp()
os.environ['PPE_ROOT'] = tmp
os.environ['PPE_DATABASE_URL'] = f'sqlite+aiosqlite:///{tmp}/app.db'

from httpx import AsyncClient, ASGITransport
from app.main import app
from app.ml.detector import Detection, FrameResult

# Inject a fake detector + fake image writer into the runtime so the camera
# pipeline runs without YOLO/cv2 but still exercises the real sync->async bridge.
import app.services.runtime as runtime
def fake_detect(frame):
    fr = FrameResult(width=64, height=48)
    fr.detections = [
        Detection('person','person',0.9,(10,5,50,45),track_id=1),
        Detection('no_helmet','no-hardhat',0.8,(20,5,40,15),track_id=None),
    ]
    return fr
runtime._detect = fake_detect  # patch detect fn used by the manager

from app.services.capture_service import get_capture_service
def fake_write(camera_id, frame):
    from app.core.config import get_settings
    from pathlib import Path
    d = get_settings().CAPTURES_DIR / camera_id; d.mkdir(parents=True, exist_ok=True)
    p = d / f"{int(time.time()*1e6)}.jpg"; p.write_bytes(b'x'); return p
get_capture_service()._write_image = fake_write

async def main():
    transport = ASGITransport(app=app)
    # use lifespan so the event loop is registered in runtime
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=transport, base_url='http://t') as c:
            # register a fake camera that emits 12 frames
            r = await c.post('/api/cameras', json={
                'camera_id':'cam-1','source_kind':'fake',
                'source_kwargs':{'frames':12},'required_ppe':['helmet'],'fps_limit':0})
            assert r.status_code == 200, r.text
            print('camera added:', r.json()['state'])

            # duplicate -> 409
            r2 = await c.post('/api/cameras', json={
                'camera_id':'cam-1','source_kind':'fake'})
            assert r2.status_code == 409
            print('duplicate add -> HTTP', r2.status_code)

            # start it
            r = await c.post('/api/cameras/cam-1/start')
            assert r.status_code == 200
            print('started:', r.json()['state'])

            # poll until it finishes draining frames
            for _ in range(60):
                st = (await c.get('/api/cameras/cam-1')).json()
                if st['state'] in ('stopped','error'):
                    break
                await asyncio.sleep(0.05)
            print('final:', st['state'], '| stats:', st['stats'])
            assert st['state'] == 'stopped', st['stats'].get('last_error')
            assert st['stats']['violations_fired'] >= 1
            assert st['stats']['captures_made'] >= 1

            # the capture should now be in the review queue via the async bridge
            pend = (await c.get('/api/review/pending')).json()
            print('review queue now has', len(pend), 'pending capture(s)')
            assert len(pend) >= 1
            assert pend[0]['camera_id'] == 'cam-1'
            assert pend[0]['reason'] == 'violation'

            # list + delete
            allcams = (await c.get('/api/cameras')).json()
            assert len(allcams) == 1
            r = await c.delete('/api/cameras/cam-1')
            assert r.status_code == 200
            print('deleted:', r.json())
            r = await c.get('/api/cameras/cam-1')
            assert r.status_code == 404
            print('gone -> HTTP', r.status_code)

    print('\n=== FULL APP (camera->pipeline->capture->review) VERIFIED ===')

asyncio.run(main())

