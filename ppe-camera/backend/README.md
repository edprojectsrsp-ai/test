# PPE Detection & Alert System — Backend

A portable, cloud/edge PPE detection system: pulls camera feeds, detects
missing safety gear per person with temporal smoothing, and — crucially —
lets you **teach the model from the dashboard** instead of hand-labeling
thousands of images upfront.

## Project Brain deployment

This service runs separately from the main Project Brain API so camera/ML
dependencies cannot destabilize project reporting:

```bash
cd ppe-detection/backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/seed_demo.py
./run.sh
```

The service listens on `http://127.0.0.1:8004`; Project Brain exposes its
review dashboard at `http://127.0.0.1:3000/ppe/`.

This README is deliberately honest about what has been **verified by automated
tests** versus what is **written but needs your hardware** (a GPU and real
camera streams) to prove out. Nothing here is oversold.

---

## What's verified (automated tests pass)

Run them yourself — no GPU, no cameras, no weights needed:

```bash
cd backend
pip install fastapi uvicorn sqlalchemy aiosqlite pydantic httpx numpy
python tests/test_active_learning_loop.py   # capture -> correct -> export YOLO
python tests/test_review_api.py             # every review endpoint over HTTP
python tests/test_camera_manager.py         # lifecycle + pipeline + multi-cam
python tests/test_full_app.py               # camera -> pipeline -> review queue
```

These cover the genuinely hard, bug-prone parts:

- **Detection taxonomy** — merges inconsistent labels from different public
  datasets (Hardhat/helmet/hard-hat → one canonical class) so you can mix
  datasets without chaos.
- **Violation engine** — per-person PPE logic with **temporal smoothing**: a
  one-frame "no helmet" is ignored; a sustained one over several frames fires.
  This is what kills false positives.
- **Active-learning loop** — every violation is captured to a review queue with
  the model's own predictions as editable overlays. Your corrections in the UI
  become normalized YOLO labels and export to a trainable dataset.
- **REST API** — all review + camera endpoints, with real error handling
  (400/404/409/422), tested over HTTP.
- **Camera manager** — per-camera worker threads, dynamic add/start/stop/remove,
  many cameras concurrently, and the sync-worker → async-DB bridge for captures.

## What's written but NOT yet verified here

These need your machine because this environment has no GPU, no model weights,
and no camera streams:

- **`app/ml/detector.py`** — the YOLO11 + ByteTrack wrapper. Structurally
  complete; not run against a real `ultralytics` install. Verify with
  `scripts/first_run.py`.
- **`app/services/sources.py`** — `WebcamSource` (easiest test, no CCTV
  needed), `RTSPSource` (primary, for real cameras). The `FakeSource` proved
  the pipeline wiring; webcam/RTSP are written but unrun here (no camera in
  this sandbox). `ScreenSource` exists but is not a focus — you said screen
  recording isn't needed.
- **Alert channels** (WhatsApp/email/webhook), **training CLI**, and the
  **Next.js dashboard** are the next pieces to build.

---

## First run (on your inference machine)

```bash
cd backend
pip install -r requirements.txt

# For CUDA, install the matching torch wheel FIRST:
#   pip install torch --index-url https://download.pytorch.org/whl/cu121

python scripts/first_run.py          # detects device, pulls yolo11m.pt, sanity check

# EASIEST test with no GPU and no CCTV -- live webcam detection in a window:
python scripts/webcam_test.py                 # require helmet+vest
python scripts/webcam_test.py --require helmet # helmet only
# On CPU this runs a few FPS -- fine for testing. It draws boxes live and
# prints [VIOLATION] lines when required gear is missing.

# Or run the API and register the webcam as a camera:
uvicorn app.main:app --reload --port 8004
#   POST /api/cameras {"camera_id":"test","source_kind":"webcam","required_ppe":["helmet"]}
#   POST /api/cameras/test/start
```

Open http://127.0.0.1:8004/docs for the interactive API.

## Virtual CCTV Lab RTSP demo

If you are using the local Virtual CCTV Lab pack in `Downloads`, the first
stream URL is:

```text
rtsp://127.0.0.1:8554/cam1
```

After starting `mediamtx` and the FFmpeg publisher, register it in this backend
with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register_virtual_rtsp_camera.ps1
```

## Portability

The same code runs on a Jetson, a GPU server, or a plain laptop. Device is
auto-detected (CUDA → MPS → CPU); override with `PPE_DEVICE=cpu`. Database is
SQLite by default (zero setup) — point at Postgres for production:

```bash
export PPE_DATABASE_URL="postgresql+asyncpg://user:pass@host/ppe"
```

---

## The "teach from the frontend" workflow

1. Cameras run in **collection mode** — every fired violation is captured.
2. The dashboard shows each capture with the model's boxes as **editable
   overlays**. An operator confirms, fixes a class, moves a box, or ignores it.
3. `POST /api/review/export` bakes all reviewed captures into a YOLO dataset
   version on disk (`data/datasets/<version>/`).
4. Fine-tune YOLO11 on that dataset + a public PPE base
   (Roboflow Construction-Safety / SH17) to produce `ppe_active.pt`.
5. Drop `ppe_active.pt` in `data/weights/` — the detector picks it up
   automatically on next reload. Accuracy improves each cycle.

**Reality check on "no 5000 images":** active learning genuinely cuts labeling
effort, but it does not remove the cold start. Start from a public PPE dataset
for a usable day-one model, then let the review loop improve it incrementally.

---

## API surface

```
GET    /health
GET    /api/review/classes                 label taxonomy for the labeler UI
GET    /api/review/pending                 review queue
GET    /api/review/captures/{id}           one capture + labels
POST   /api/review/captures/{id}/labels    submit human corrections
POST   /api/review/captures/{id}/ignore    drop from training path
POST   /api/review/export                  bake labeled captures -> YOLO dataset
GET    /api/review/image/{id}              the captured frame (jpg)

POST   /api/cameras                        register (rtsp|screen|fake)
POST   /api/cameras/{id}/start
POST   /api/cameras/{id}/stop
DELETE /api/cameras/{id}
GET    /api/cameras                        status of all
GET    /api/cameras/{id}                   status of one
```

## Layout

```
backend/app/
  core/       config (device/paths/db url), async DB engine
  ml/         taxonomy, detector (YOLO+ByteTrack), violation engine
  models/     review-queue + training-label ORM
  services/   sources, camera_manager, capture, review, runtime wiring
  routers/    review + cameras HTTP APIs
  schemas/    pydantic request/response
  main.py     app entrypoint (lifespan inits DB, wires manager)
tests/        four verified suites (run without GPU/cameras)
scripts/      first_run.py
```
