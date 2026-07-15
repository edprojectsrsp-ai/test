import sys, asyncio, tempfile, os
sys.path.insert(0, '.')
# use a temp DB + data dir so the test is isolated
tmp = tempfile.mkdtemp()
os.environ['PPE_ROOT'] = tmp
os.environ['PPE_DATABASE_URL'] = f'sqlite+aiosqlite:///{tmp}/test.db'

from app.core.db import init_db, SessionLocal
from app.core.config import get_settings
from app.ml.detector import Detection, FrameResult
from app.ml.violations import FiredViolation
from app.services.capture_service import get_capture_service
from app.services.review_service import get_review_service
from app.models.review import CaptureStatus

# monkeypatch image write (no OpenCV in sandbox)
cs = get_capture_service()
def fake_write(camera_id, frame):
    from pathlib import Path
    p = get_settings().CAPTURES_DIR / camera_id
    p.mkdir(parents=True, exist_ok=True)
    import time
    fp = p / f"{int(time.time()*1e6)}.jpg"
    fp.write_bytes(b"fakejpeg")
    return fp
cs._write_image = fake_write

async def main():
    await init_db()
    rs = get_review_service()
    fr = FrameResult(width=640, height=480)
    fr.detections = [
        Detection('person','person',0.9,(100,100,200,400),7),
        Detection('no_helmet','no-hardhat',0.8,(120,100,180,150),None),
    ]
    fired = FiredViolation(track_id=7, gear='helmet', person_box=(100,100,200,400), confidence=0.8, at=0)

    async with SessionLocal() as s:
        # 1. capture a violation
        item = await cs.capture_violation(s, 'cam-1', b'frame', fr, fired)
        assert item is not None, "first capture should succeed"
        print('captured:', item.id[:8], item.reason.value, item.status.value)
        cap_id = item.id
        # 2. cooldown: immediate second identical fire -> throttled (None)
        dup = await cs.capture_violation(s, 'cam-1', b'frame', fr, fired)
        assert dup is None, "duplicate within cooldown should be throttled"
        print('cooldown OK (duplicate suppressed)')
        # 3. predictions attached as editable overlays
        assert len(item.predictions) == 2
        print('predictions attached:', len(item.predictions), 'boxes')

        # 4. human corrects: confirm person, fix the no_helmet box, add a vest box
        corrected = [
            {'cls':'person','xyxy':[100,100,200,400]},
            {'cls':'no_helmet','xyxy':[118,98,182,152]},
            {'cls':'vest','xyxy':[110,200,190,320]},
        ]
        item2 = await rs.apply_corrections(s, cap_id, corrected)
        assert item2.status == CaptureStatus.labeled
        assert len(item2.labels) == 3
        print('corrections applied:', len(item2.labels), 'labels, status:', item2.status.value)

        # 5. reject a bad class
        try:
            await rs.apply_corrections(s, cap_id, [{'cls':'banana','xyxy':[0,0,10,10]}])
            assert False, "should reject unknown class"
        except ValueError as e:
            print('bad class rejected:', str(e))

        # 6. a second capture we will IGNORE
        fired2 = FiredViolation(track_id=9, gear='vest', person_box=(300,100,400,400), confidence=0.7, at=0)
        item3 = await cs.capture_violation(s, 'cam-1', b'frame', fr, fired2)
        await rs.ignore(s, item3.id)
        print('ignored capture:', item3.id[:8])

        # 7. export YOLO dataset -> only the labeled one should export
        manifest = await rs.export_yolo(s, 'v1')
        print('export manifest:', manifest['exported_items'], 'items ->', manifest['version'])
        assert manifest['exported_items'] == 1

        # 8. verify the YOLO label file on disk
        from pathlib import Path
        lbl_dir = Path(manifest['dataset_dir']) / 'labels'
        files = list(lbl_dir.glob('*.txt'))
        assert len(files) == 1
        content = files[0].read_text().strip().split('\n')
        print('YOLO label file has', len(content), 'lines:')
        for line in content:
            print('   ', line)
        # class ids: person=0, no_helmet=2, vest=3
        ids = sorted(int(l.split()[0]) for l in content)
        assert ids == [0,2,3], f"unexpected class ids {ids}"
        # verify normalization is in [0,1]
        for l in content:
            vals = [float(x) for x in l.split()[1:]]
            assert all(0<=v<=1 for v in vals), "coords must be normalized"

        # 9. data.yaml sanity -- class count tracks the live taxonomy
        from app.ml.taxonomy import CANONICAL_CLASSES
        yaml_txt = Path(manifest['data_yaml']).read_text()
        assert 'no_helmet' in yaml_txt and f'nc: {len(CANONICAL_CLASSES)}' in yaml_txt
        print('data.yaml OK')

    print('\n=== FULL ACTIVE-LEARNING LOOP VERIFIED ===')

asyncio.run(main())

