import sys, asyncio, tempfile, os
sys.path.insert(0, '.')
tmp = tempfile.mkdtemp()
os.environ['PPE_ROOT'] = tmp
os.environ['PPE_DATABASE_URL'] = f'sqlite+aiosqlite:///{tmp}/api.db'

from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.db import SessionLocal
from app.core.config import get_settings
from app.models.review import CaptureItem, CaptureReason, CaptureStatus

async def seed_capture():
    """Insert one pending capture with a fake image + predictions."""
    s = get_settings()
    cam_dir = s.CAPTURES_DIR / 'cam-1'
    cam_dir.mkdir(parents=True, exist_ok=True)
    img = cam_dir / 'seed.jpg'
    img.write_bytes(b'\xff\xd8\xff\xe0fakejpeg')  # jpeg-ish header
    async with SessionLocal() as db:
        item = CaptureItem(
            camera_id='cam-1', image_path=str(img),
            reason=CaptureReason.violation, status=CaptureStatus.pending,
            predictions=[
                {'cls':'person','raw':'person','conf':0.9,'xyxy':[100,100,200,400],'track_id':7},
                {'cls':'no_helmet','raw':'no-hardhat','conf':0.42,'xyxy':[120,100,180,150],'track_id':None},
            ],
            width=640, height=480, note='missing helmet (track 7)',
        )
        db.add(item); await db.commit(); await db.refresh(item)
        return item.id

async def main():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://t') as c:
        # lifespan doesn't auto-run with ASGITransport; init db manually
        from app.core.db import init_db
        await init_db()

        # health
        r = await c.get('/health'); print('health:', r.status_code, r.json())
        assert r.status_code == 200

        # classes for labeler UI
        r = await c.get('/api/review/classes')
        assert r.status_code == 200
        cls = r.json()
        assert 'no_helmet' in cls['classes'] and 'no_helmet' in cls['violation_classes']
        print('classes:', len(cls['classes']), 'total,', len(cls['violation_classes']), 'violation')

        cap_id = await seed_capture()
        print('seeded capture:', cap_id[:8])

        # pending queue
        r = await c.get('/api/review/pending')
        assert r.status_code == 200 and len(r.json()) == 1
        item = r.json()[0]
        assert item['image_url'] == f'/api/review/image/{cap_id}'
        assert len(item['predictions']) == 2
        print('pending:', len(r.json()), 'item, predictions:', len(item['predictions']))

        # fetch the image bytes
        r = await c.get(f'/api/review/image/{cap_id}')
        assert r.status_code == 200 and r.headers['content-type'] == 'image/jpeg'
        print('image served:', len(r.content), 'bytes')

        # capture detail (no labels yet)
        r = await c.get(f'/api/review/captures/{cap_id}')
        assert r.status_code == 200 and r.json()['labels'] == []
        print('detail: labels =', r.json()['labels'])

        # submit corrections
        r = await c.post(f'/api/review/captures/{cap_id}/labels', json={
            'boxes': [
                {'cls':'person','xyxy':[100,100,200,400]},
                {'cls':'no_helmet','xyxy':[118,98,182,152]},
                {'cls':'vest','xyxy':[110,200,190,320]},
            ]
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d['status'] == 'labeled' and len(d['labels']) == 3
        print('corrections: status =', d['status'], '| labels =', len(d['labels']))

        # bad class -> 400
        r = await c.post(f'/api/review/captures/{cap_id}/labels', json={
            'boxes': [{'cls':'banana','xyxy':[0,0,10,10]}]})
        assert r.status_code == 400
        print('bad class -> HTTP', r.status_code, '|', r.json()['detail'])

        # 404 for missing capture
        r = await c.get('/api/review/captures/does-not-exist')
        assert r.status_code == 404
        print('missing capture -> HTTP', r.status_code)

        # export
        r = await c.post('/api/review/export', json={'version':'v1'})
        assert r.status_code == 200, r.text
        exp = r.json()
        assert exp['exported_items'] == 1
        print('export: version', exp['version'], '| items', exp['exported_items'])

        # invalid version (validation) -> 422
        r = await c.post('/api/review/export', json={'version':'bad/slash'})
        assert r.status_code == 422
        print('invalid version -> HTTP', r.status_code, '(validation)')

    print('\n=== REST API FULLY VERIFIED ===')

asyncio.run(main())

