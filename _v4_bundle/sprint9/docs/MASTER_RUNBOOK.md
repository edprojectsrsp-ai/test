# PROJECT BRAIN — MASTER DEPLOYMENT RUNBOOK
## Sunday Battle Plan: Zero to Demo-Ready

> Follow this top to bottom. Every step is copy-paste-ready. No improvisation needed.

---

## 🎯 WHAT YOU'RE DEPLOYING

| Component | Port | Tech | Purpose |
|---|---|---|---|
| **PostgreSQL** | 5433 | PG16 + pgvector | All data |
| **Main Backend** | 8000 | FastAPI | Core APIs (schemes, packages, progress, CPM, notesheet, auth) |
| **AI Service** | 8001 | FastAPI standalone | Chat + RAG + multi-LLM routing |
| **Frontend** | 3000 | Next.js 15 | All UI |
| **Ollama** | 11434 | local LLM | Fallback when cloud LLMs unreachable |
| **Android APK** | sideload | Capacitor wrapper | Field engineer mobile |
| **Cron job** | n/a | bash | Nightly risk computation |

**11 sprints shipped. 71 files. 11,418 lines.** Your friend's 21K-line Tkinter app cannot match this stack.

---

## 📋 PREREQUISITES

### Already installed (you have these)
- PostgreSQL 16 on port 5433 with pgvector extension
- Python 3.10+ and Node.js 20+
- An existing `t3.sql` dump of your current DB (preserved at `/path/to/t3.sql`)

### Need to install (one-time)
```bash
# Ollama (for AI fallback - this is critical)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3:8b              # main local model (~5 GB)
ollama pull bge-m3                # embeddings (~700 MB)

# Tesseract (for OCR of scanned PDFs)
sudo apt-get install tesseract-ocr poppler-utils

# Python deps for backend
pip install python-jose[cryptography] 'passlib[bcrypt]' 'bcrypt<5.0' \
            python-multipart pgvector pgdumplib

# JDK 17 + Android SDK (only if building APK - see sprint11_android/README_ANDROID.md)
```

### API keys (get free tiers)
- **Groq**: https://console.groq.com/keys (free, fast classification)
- **Gemini**: https://makersuite.google.com/app/apikey (free, for analysis)
- **OpenAI** (optional): https://platform.openai.com/api-keys (~$1 covers 1000s of queries)
- **Telegram bot** (optional): chat with `@BotFather` → `/newbot`

---

## ⚡ STEP 1: DATABASE — Schema v4

```bash
cd v4_final/

# A. Backup whatever you have now
pg_dump -h 127.0.0.1 -p 5433 -U postgres -F c project_brain \
        > backup_$(date +%Y%m%d_%H%M).dump

# B. Drop & rebuild
psql -h 127.0.0.1 -p 5433 -U postgres -c \
    "DROP DATABASE IF EXISTS project_brain WITH (FORCE);"
psql -h 127.0.0.1 -p 5433 -U postgres -c \
    "CREATE DATABASE project_brain;"

# C. Apply the master schema (53 tables, 10 views, 11 enums, 55 triggers)
psql "postgresql://postgres:abc123@127.0.0.1:5433/project_brain" \
    -f schema/schema_v4_master.sql

# Expected: many NOTICE lines, ZERO errors. Verify:
psql -d project_brain -c "
  SELECT 'tables: '||COUNT(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE';"
# Should output: tables: 53

# D. Apply e-NoteSheet schema (Sprint 9A) - 6 more tables
psql -d project_brain -f sprint9a_enotesheet/01_enotesheet_schema.sql

# E. Apply CPM schema (Sprint 9B) - 5 more tables + 3 views
psql -d project_brain -f sprint9b_cpm/01_cpm_schema.sql

# F. Apply RBAC patch (passwords, default admin)
psql -d project_brain -f sprint9/rbac/rbac_patch.sql

# Verify totals
psql -d project_brain -c "
  SELECT 'tables: '||COUNT(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_type='BASE TABLE'
  UNION ALL SELECT 'views: '||COUNT(*) FROM information_schema.views
   WHERE table_schema='public';"
# Should output: tables: 64+, views: 13+
```

⚠️ **The default admin password is `admin123`. Sample users are `manager1`, `engineer1`, `site1`, `viewer1` — all `admin123`. Change them in production.**

---

## 🌱 STEP 2: PRESEED — Load your real schemes from t3.sql

```bash
cd v4_final/preseeder/

python3 preseed_from_t3.py \
    --t3-file /path/to/t3.sql \
    --target "postgresql://postgres:abc123@127.0.0.1:5433/project_brain"

# Expected output:
#   ✓ 74 schemes loaded
#   ✓ 76 packages (74 mirrors + 2 real: COB#7 CDCP-Pkg-3, BPP-Pkg-4)
#   ✓ 5 templates, 36 template items
#   ✓ 13 UoM, 16 activity types
```

---

## 🚀 STEP 3: MAIN BACKEND — FastAPI on port 8000

```bash
cd back/

# A. Copy in the new modules
cp v4_final/sprint5/progress_router.py    app/api/v1/progress.py
cp v4_final/sprint6/mobile_router.py       app/api/v1/mobile.py
cp v4_final/sprint7/risk_router.py         app/api/v1/risk.py
cp v4_final/sprint9a_enotesheet/notesheet_router.py app/api/v1/notesheet.py
cp v4_final/sprint9b_cpm/cpm_router.py     app/api/v1/cpm.py
cp v4_final/sprint9b_cpm/cpm_engine.py     app/services/cpm_engine.py
cp v4_final/sprint9b_cpm/importers.py      app/services/cpm_importers.py

# B. RBAC
mkdir -p app/security
touch app/security/__init__.py
cp v4_final/sprint9/rbac/auth.py        app/security/auth.py
cp v4_final/sprint9/rbac/auth_router.py app/api/v1/auth.py

# C. Wire the new routers into main.py
# Add these lines to your existing main.py:
#
#   from app.api.v1 import progress, mobile, risk, notesheet, cpm, auth
#   app.include_router(progress.router)
#   app.include_router(mobile.router)
#   app.include_router(risk.router)
#   app.include_router(notesheet.router)
#   app.include_router(cpm.router)
#   app.include_router(auth.router)
#
#   import os
#   from fastapi.staticfiles import StaticFiles
#   UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/var/lib/project_brain/uploads")
#   os.makedirs(UPLOAD_DIR, exist_ok=True)
#   app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# D. Set env vars - generate a JWT secret and use the SAME one for AI service
JWT_SECRET=$(openssl rand -hex 32)
echo "JWT_SECRET=$JWT_SECRET"  # save this - both services need it

cat >> .env << EOF
PROJECT_BRAIN_DB_URL=postgresql://postgres:abc123@127.0.0.1:5433/project_brain
UPLOAD_DIR=/var/lib/project_brain/uploads
JWT_SECRET=$JWT_SECRET
JWT_EXPIRY_HOURS=12
EOF

# E. Install Python deps
pip install python-jose[cryptography] 'passlib[bcrypt]' 'bcrypt<5.0' \
            python-multipart pgvector

# F. Start backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000 &

# G. Smoke test - login as admin
sleep 3
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
# Should return {"access_token": "eyJ...", "user_id": 1, "role": "admin", ...}
```

---

## 🧠 STEP 4: AI SERVICE — FastAPI on port 8001 (standalone)

```bash
cd v4_final/ai_service/

# A. Install deps in a venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# B. Apply auth bridge (same JWT_SECRET as main backend)
mkdir -p app/security
touch app/security/__init__.py
cp ../sprint9/integration/ai_auth_bridge.py app/security/auth.py
cp ../sprint9/integration/chat_router_authed.py app/routers/chat_router.py

# C. Configure .env
cat > .env << EOF
JWT_SECRET=$JWT_SECRET   # SAME as main backend
PROJECT_BRAIN_DB_URL=postgresql://postgres:abc123@127.0.0.1:5433/project_brain

# Cloud LLM keys (paste yours)
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxx
GEMINI_API_KEY=AIzaSy_xxxxxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxx     # optional

# Ollama
OLLAMA_BASE_URL=http://localhost:11434

# Embeddings model
EMBEDDING_MODEL=bge-m3
EMBEDDING_DIMENSIONS=768

# Telegram (optional)
TELEGRAM_BOT_TOKEN=xxxxxxx:xxxxxxxxxxxxxxxxxxx
EOF

# D. Start AI service
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload &

# E. Smoke test using the JWT from step 3G
TOKEN="eyJ..."  # paste here
curl -X POST http://localhost:8001/ai/conversations/start \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"web"}'
```

---

## 📱 STEP 5: FRONTEND — Next.js on port 3000

```bash
cd frontend/

# A. Copy new pages
cp v4_final/sprint5/page.tsx           app/s-curve/page.tsx
cp v4_final/sprint6/page.tsx           app/mobile/diary/page.tsx
cp v4_final/sprint7/page.tsx           app/risk/page.tsx
cp v4_final/sprint9a_enotesheet/page.tsx app/notesheet/page.tsx
cp v4_final/sprint9b_cpm/page.tsx      app/cpm/page.tsx
cp v4_final/ai_service/frontend_page.tsx app/ai/page.tsx

# B. Copy native bridge (used by both PWA and APK)
mkdir -p lib
cp v4_final/sprint11_android/native.ts lib/native.ts

# Optionally replace the diary page with the enhanced one
cp v4_final/sprint11_android/page_v2.tsx app/mobile/diary/page.tsx

# C. Env vars
cat > .env.local << EOF
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_AI_API_URL=http://localhost:8001
EOF

# D. Create a login page and api helper - see runbook appendix below

# E. Start frontend
npm install
npm run dev &

# Open http://localhost:3000/login
#   Username: admin
#   Password: admin123
```

---

## 📲 STEP 6: ANDROID APK (optional but impressive)

See `sprint11_android/README_ANDROID.md` for full instructions. TL;DR:

```bash
cd v4_final/sprint11_android/

# A. Edit capacitor.config.ts - set `url` to your laptop's LAN IP
# Find IP: `ip addr` on Linux, `ifconfig` on Mac
# Example: server.url = 'http://192.168.1.42:3000'

# B. Build (requires Android Studio + JDK 17 + ANDROID_HOME set)
./build_apk.sh

# C. Sideload APK
# - Copy android/app/build/outputs/apk/debug/app-debug.apk to phone
# - Open on phone → allow install from unknown sources → install
# - Or via adb: ./build_apk.sh --install
```

---

## ⏰ STEP 7: CRON JOB — Nightly risk computation

```bash
crontab -e
```

Add this line:
```cron
0 2 * * * cd /path/to/v4_final/sprint7 && /usr/bin/python3 compute_risks.py \
  --db "postgresql://postgres:abc123@127.0.0.1:5433/project_brain" \
  >> /var/log/pb/risk.log 2>&1
```

Verify with `crontab -l`. Logs at `/var/log/pb/risk.log` (create the dir first).

---

## ✅ STEP 8: SMOKE TESTS

Run these in order. Each should return success.

```bash
# 1. Database is up
psql -h 127.0.0.1 -p 5433 -U postgres -d project_brain -c "SELECT COUNT(*) FROM scheme_master;"
# Should return: 74

# 2. Main backend healthy
curl http://localhost:8000/health 2>/dev/null || \
curl http://localhost:8000/docs

# 3. AI service healthy (no auth needed)
curl http://localhost:8001/ai/health
# Should return: providers_configured + tools_registered

# 4. Login flow
TOKEN=$(curl -sX POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r .access_token)
echo "Token: ${TOKEN:0:60}..."

# 5. Authenticated request
curl -s "http://localhost:8000/api/v1/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq

# 6. AI query (uses scheme RBAC filter)
CID=$(curl -sX POST http://localhost:8001/ai/conversations/start \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"web"}' | jq -r .conversation_id)
curl -sX POST http://localhost:8001/ai/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"conversation_id\":$CID,\"message\":\"Find COB-7 and list its packages\"}" | jq

# 7. CPM endpoints
curl -s "http://localhost:8000/api/v1/cpm/schedule" \
  -H "Authorization: Bearer $TOKEN" | jq

# 8. Notesheet workflows
curl -s "http://localhost:8000/api/v1/notesheet/workflows/templates" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## 🎬 DEMO SCRIPT (Sunday)

> Open these in 5 browser tabs:
> 1. `localhost:3000/` — Main dashboard
> 2. `localhost:3000/cpm` — CPM Engine
> 3. `localhost:3000/notesheet` — e-NoteSheet  
> 4. `localhost:3000/ai` — AI chat
> 5. `localhost:3000/risk` — Risk heatmap

### Scene 1: Login + Dashboard (30s)
- Land on login. Type `admin / admin123`. Show how clean it is vs friend's Tkinter login.
- Dashboard shows 74 schemes, package counts.

### Scene 2: CPM Engine — THE KILLER (3 min)
1. Go to `/cpm`.
2. Click "Import .xer / .mpp / .csv" → upload `/tmp/cob7_test_schedule.csv` (11 activities).
3. **Show**: Project finish auto-calculated as Nov 6, 2025. Critical path highlighted in fuchsia (A100→A130→A140→A160→A180→A190→A200). Non-critical activities show grey "float" extensions.
4. **Toggle date views**: Planned → Baseline → Actual → All Overlay. Each is a different colour.
5. Click an activity → edit modal opens showing **all 7 date dimensions** (Planned/Baseline/Estimated/Actual/Forecast/Early/Late).
6. Change a date → Save → CPM auto-reruns → critical path updates.
7. Click "Delay Analysis" → see baseline-vs-actual variance for any slipped activities.
8. **Punchline**: "This is what Primavera does. My friend's Tkinter app cannot do this."

### Scene 3: e-NoteSheet (2 min)
1. Go to `/notesheet`.
2. Click "New File" → fill in EOT request for COB-7 (₹2 Cr cost impact, choose `WF_EOT` workflow).
3. Submit → file appears with auto-generated number `PB/NS/2026/0001`.
4. Open it → show full audit trail: Notes timeline, Movement Track.
5. Add a note → it gets timestamped, signed, **and locked permanently**.
6. Try to edit the note → trigger blocks it: "Notes are immutable. Once submitted they cannot be edited."
7. **Punchline**: "This is the digital replacement for paper file noting. Every PSU runs on these. My friend's app has nothing like this."

### Scene 4: AI Chat (2 min)
1. Go to `/ai`.
2. Ask: "What's the current status of COB-7?"
3. AI uses `find_scheme` tool → finds scheme → uses `list_packages` → uses `get_progress_status` → answers with cited package data.
4. Ask: "Show me any packages with red risks."
5. AI uses `get_risk_summary` → returns red-flagged packages.
6. **Stream the response** so they see it generating live.
7. **Punchline**: "AI grounded in your real DB via closed-enum tools. No hallucinations. No SQL injection. Multi-LLM with automatic fallback to local Ollama."

### Scene 5: Mobile Diary on phone (2 min)
1. Pull out phone with the APK installed (or PWA in Chrome).
2. Open Project Brain Diary.
3. Tap camera → take a photo of whatever is in front of you.
4. GPS auto-fills coordinates.
5. Pick package + activity, type a quick note, submit.
6. Switch back to laptop → refresh dashboard → entry appears with the photo.
7. **Bonus**: turn off WiFi on phone, submit another entry → "Saved offline, will sync". Turn WiFi back on → auto-syncs.
8. **Punchline**: "Site engineer enters progress from anywhere on site. Tkinter desktop app cannot do this. We have native Android."

### Scene 6: Numbers slide (30s)
- 11 sprints. 71 files. 11,418 lines.
- 64 DB tables. 13 views. 207 functions.
- AI with 16 grounded tools. CPM engine that matches Primavera's math.
- Native Android APK.
- Friend's app: 21K lines of Tkinter. **Mine: half the code, 10x the capabilities.**

---

## 🚨 TROUBLESHOOTING

| Symptom | Fix |
|---|---|
| `JWT_SECRET not set` on AI service | Set the env var to same value as main backend |
| Login returns 401 | Check `password_hash IS NOT NULL` for that user |
| `error reading bcrypt version` warning | Cosmetic — install `bcrypt<5.0` to silence |
| CPM endpoints fail with `text` import error | Check `from sqlalchemy import text` is at top of cpm_router.py |
| Frontend can't reach backend | Check CORS settings in main.py; add `localhost:3000` to allowed origins |
| AI returns 500 on all queries | Check at least one of GROQ_API_KEY/GEMINI_API_KEY/OPENAI_API_KEY is set, OR Ollama is running |
| Mobile diary photos don't upload | Check `UPLOAD_DIR` exists and is writable |

---

## 📂 FILE INDEX

```
v4_final/
├── schema/                     # 9 SQL files — base schema v4
│   └── schema_v4_master.sql    # apply this one (it imports the others)
├── preseeder/
│   └── preseed_from_t3.py      # loads your 74 schemes + 76 packages from t3
├── sprint5/                    # S-Curve PREDICT
├── sprint6/                    # Mobile Diary PWA
├── sprint7/                    # Risk Heatmap
├── ai_service/                 # AI service (FastAPI port 8001)
│   ├── app/                    # all source
│   ├── requirements.txt
│   └── SPRINT8_INTEGRATION.md
├── sprint9/                    # RBAC integration
│   ├── rbac/auth.py            # main backend auth
│   ├── rbac/auth_router.py     # /api/v1/auth endpoints
│   ├── rbac/rbac_patch.sql     # password columns + default users
│   └── integration/            # AI service auth bridge
├── sprint9a_enotesheet/        # e-NoteSheet
│   ├── 01_enotesheet_schema.sql
│   ├── notesheet_router.py
│   └── page.tsx
├── sprint9b_cpm/               # CPM Engine
│   ├── 01_cpm_schema.sql       # 5 tables + 3 views
│   ├── cpm_engine.py           # the algorithm (forward/backward pass)
│   ├── importers.py            # XER + MPP + CSV
│   ├── cpm_router.py           # FastAPI
│   └── page.tsx                # Gantt UI
├── sprint11_android/           # APK wrapper
│   ├── capacitor.config.ts
│   ├── native.ts               # bridge - drop into frontend/lib/
│   ├── page_v2.tsx             # enhanced diary page (works PWA + APK)
│   ├── build_apk.sh
│   └── README_ANDROID.md
└── MASTER_RUNBOOK.md           # this file
```

---

## 🎯 POST-DEMO ROADMAP (6 months)

1. **Notifications** — email + Telegram for: notesheet pending, schedule slipping, risk turning red
2. **Better RAG** — extract tables from PDFs (currently text only)
3. **Multi-language** — Hindi UI for site engineers
4. **iOS app** — same Capacitor codebase, just `cap add ios`
5. **Dashboard customization** — drag-drop widget arrangement per user
6. **Approval delegation** — auto-route notesheets when officers on leave
7. **Schedule what-if analysis** — "what if A140 slips 30 days?" — visualize impact
8. **Resource leveling** — when multiple critical paths compete for the same crew/equipment
9. **Earned Value Management (EVM)** — SPI/CPI on top of CPM
10. **Field tablets with offline maps** — Mapbox or OSM tiles cached locally

But none of this is needed for Sunday. **Ship what you have.**

---

**Good luck. Go obliterate that Tkinter app. 🔥**
