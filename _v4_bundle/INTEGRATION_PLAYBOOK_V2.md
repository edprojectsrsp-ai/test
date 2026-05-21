# PROJECT BRAIN — V4 INTEGRATION PLAYBOOK

> **What's in this bundle:** Final Schema v4 + Preseeder + Sprints 5/6/7 code, ready to drop into your Next.js + FastAPI stack at `/back` and `/frontend`.

---

## 0. PRE-FLIGHT

### Backup existing DB

```bash
pg_dump -h 127.0.0.1 -p 5433 -U postgres -F c project_brain > backup_pre_v4_$(date +%Y%m%d).dump
```

### Install pgvector

Ubuntu/Debian:
```bash
sudo apt-get update && sudo apt-get install -y postgresql-16-pgvector
```

Or from source (any platform):
```bash
git clone https://github.com/pgvector/pgvector.git && cd pgvector
make && sudo make install
```

Test it: `psql -d project_brain -c "CREATE EXTENSION vector;"`

---

## 1. DEPLOY SCHEMA v4 (one-shot, no migrations)

```bash
cd schema/
# Drops the existing public schema and rebuilds. Your data WILL be lost
# unless you preseed it back in step 2.
psql "postgresql://postgres:abc123@127.0.0.1:5433/project_brain" -f schema_v4_master.sql
```

**Expected output:** 53 tables, 10 views, 11 enums, 55 triggers.

---

## 2. PRESEED FROM t3.sql

```bash
cd preseeder/
pip install pgdumplib psycopg2-binary
python3 preseed_from_t3.py \
    --t3-file /path/to/your/t3.sql \
    --target "postgresql://postgres:abc123@127.0.0.1:5433/project_brain"
```

**Expected results:**
- 74 schemes
- 76 packages (74 mirrors + 2 real for multi-pkg scheme)
- 5 templates (4 default + 1 from t3) with 36 items
- 13 UoM rows, 16 activity master rows

---

## 3. SPRINT 5 — S-CURVE PREDICT

### Backend
Copy `sprint5/progress_router.py` → `back/app/api/v1/progress.py`

Wire it in `back/main.py`:
```python
from app.api.v1 import progress
app.include_router(progress.router)
```

### Frontend
Copy `sprint5/page.tsx` → `frontend/app/s-curve/page.tsx`

Already uses `recharts`, `framer-motion`, `lucide-react` (already in your stack).

### Test
```bash
# Insert a few monthly progress points
curl -X POST http://localhost:8000/api/v1/progress/monthly \
  -H "Content-Type: application/json" \
  -d '{"package_id":1,"month_date":"2024-01-01","planned_progress_pct":10,"actual_progress_pct":8}'

# Get the S-curve
curl http://localhost:8000/api/v1/progress/s-curve/1
```

Then visit http://localhost:3000/s-curve

---

## 4. SPRINT 6 — MOBILE PWA SITE DIARY

### Backend
Copy `sprint6/mobile_router.py` → `back/app/api/v1/mobile.py`

Configure uploads in `back/main.py`:
```python
import os
from fastapi.staticfiles import StaticFiles
from app.api.v1 import mobile
app.include_router(mobile.router)
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/var/lib/project_brain/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
```

### Frontend
Copy `sprint6/page.tsx` → `frontend/app/mobile/diary/page.tsx`

Enable as PWA — add to `frontend/public/manifest.json`:
```json
{
  "name": "Project Brain Site Diary",
  "short_name": "PB Diary",
  "start_url": "/mobile/diary",
  "display": "standalone",
  "background_color": "#09090b",
  "theme_color": "#6366f1",
  "icons": [{"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"}]
}
```

### Test on phone
Open http://YOUR_LAN_IP:3000/mobile/diary on phone → "Add to Home Screen". Photo + GPS use native APIs; no extra config needed.

---

## 5. SPRINT 7 — RISK HEATMAP

### Backend
Copy `sprint7/risk_router.py` → `back/app/api/v1/risk.py`

Wire it:
```python
from app.api.v1 import risk
app.include_router(risk.router)
```

### Nightly job
Copy `sprint7/compute_risks.py` → `/opt/pb/compute_risks.py`

Cron entry:
```
0 2 * * * /usr/bin/python3 /opt/pb/compute_risks.py --db "postgresql://postgres:abc123@127.0.0.1:5433/project_brain"
```

Or first-time run:
```bash
python3 compute_risks.py --db "postgresql://postgres:abc123@127.0.0.1:5433/project_brain" --verbose
```

### Frontend
Copy `sprint7/page.tsx` → `frontend/app/risk/page.tsx`

Visit http://localhost:3000/risk

---

## 6. VERIFY EVERYTHING

```bash
# Schema in place
psql -d project_brain -c "SELECT 
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') as tables,
    (SELECT COUNT(*) FROM information_schema.views WHERE table_schema='public') as views,
    (SELECT COUNT(*) FROM scheme_master WHERE NOT is_deleted) as schemes,
    (SELECT COUNT(*) FROM packages WHERE NOT is_deleted) as packages;"

# Triggers fire on lifecycle date insert
psql -d project_brain -c "
INSERT INTO scheme_formulation(scheme_id, dic_approval_date, created_by, updated_by)
VALUES(1, '2024-06-15', 1, 1);
SELECT event_type, event_date FROM lifecycle_events WHERE scheme_id=1;"

# Update DIC date → should create SECOND event preserving history (this is the magic)
psql -d project_brain -c "
UPDATE scheme_formulation SET dic_approval_date='2024-08-20' WHERE scheme_id=1;
SELECT event_type, event_date FROM lifecycle_events WHERE scheme_id=1 ORDER BY event_date;"
```

---

## 7. WHAT BEATS YOUR FRIEND'S APP

| Feature | Friend's Tkinter+psycopg2 | Project Brain v4 |
|---|---|---|
| Schema | 21,049 LoC, drift-prone | 53 tables, audited, typed enums |
| Date history | Single column per stage (overwrite!) | `lifecycle_events` stream — every change preserved |
| Multi-package retender | One row, manual reconciliation | `tender_cycles.cycle_no` with full bid/price/negotiation per cycle |
| Progress forecasting | None | Linear regression with confidence intervals + explainer |
| Mobile data capture | Email/WhatsApp screenshots | PWA with GPS + camera, native input |
| Risk visibility | Calls to PMs | Nightly 5-rule scan + heatmap UI |
| AI assistant | None | pgvector + documents ready, Sprint 8 next |
| Audit trail | None | `audit_log` writes before/after JSON for every change |

---

## NEXT (after this is deployed): SPRINT 8 — AI Assistant

The schema already includes everything Sprint 8 needs:
- `documents`, `document_chunks`, `document_embeddings` (with pgvector ready)
- `scheme_correspondence`, `record_notes`, `commitments`, `ad_hoc_approvals`
- `ai_conversations`, `ai_messages`

When you message me again I'll ship the standalone `ai_service/` on port 8001 with:
- 4-provider router (Groq Llama 8B → Gemini 2.5 Flash → GPT-4o-mini → Ollama Qwen3 fallback)
- BGE-M3 embeddings via Ollama
- 18 tool calls covering all 10 AI capabilities you outlined
- Document ingestion pipeline (OCR, chunk, embed)
- Telegram bot for asking questions during meetings

---

## SUPPORT

If a step fails:
1. `psql -d project_brain -c "SELECT * FROM monitoring_log ORDER BY occurred_at DESC LIMIT 20"` — shows last events
2. `psql -d project_brain -c "SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT 20"` — shows last data changes
3. Schema not applying? Drop pgvector extension if your install lacks it (`05_godmode_ai.sql` line: `CREATE EXTENSION vector`)
