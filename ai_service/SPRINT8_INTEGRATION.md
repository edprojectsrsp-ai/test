# PROJECT BRAIN — AI SERVICE (Sprint 8)

> Standalone FastAPI on port 8002. Independent of your main backend at port 8000.

## ARCHITECTURE — Why Standalone

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Next.js Frontend│     │  Main Backend    │     │   AI Service     │
│  port 3000       │────▶│  port 8000       │     │   port 8002      │
│                  │     │  (your existing) │     │  (this bundle)   │
└────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                        │                         │
         └────────────────────────┴─────────────────────────┘
                                  │
                       ┌──────────▼──────────┐
                       │  PostgreSQL v4      │
                       │  port 5433          │
                       │  + pgvector         │
                       └─────────────────────┘
```

**Why separate?**
1. **AI failures don't affect your main app.** Backend stays up even if Gemini is down.
2. **Different scaling profile.** AI calls are slow (1-15s), main backend is fast (<200ms).
3. **Easy to swap providers.** Add Anthropic Claude tomorrow? Just edit `providers/`.
4. **Independent deploys.** Update AI service without touching backend.

## ROUTING — Task-Aware (Smarter Than Chains)

| Query Type | Primary Provider | Why |
|---|---|---|
| `classify` (intent detection) | Groq Llama 3.3 70B | 300ms response, dirt cheap |
| `lookup` (facts, lists, counts) | Groq Llama 3.3 70B | Tool call → DB → format, no reasoning needed |
| `analysis` (why? compare? risk?) | Gemini 2.5 Flash | Multi-step reasoning + 1M context |
| `report` (draft a note/memo) | OpenAI GPT-4o-mini | Best prose quality, structured |
| `rag` (document Q&A) | Gemini 2.5 Flash | 1M context window swallows whole docs |
| Anything (fallback) | Ollama Qwen3 8B | Local, free, never offline |

**Fallback chains run automatically.** If Gemini errors, Gemini-task queries fall through to OpenAI → Ollama. Zero downtime.

## 1. PRE-FLIGHT

### Install Python deps
```bash
cd ai_service/
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

### Install Tesseract (for OCR)
```bash
sudo apt-get install tesseract-ocr poppler-utils
```

### Install Ollama (local fallback + embeddings)
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3:8b           # Local LLM fallback
ollama pull bge-m3             # Or:
# Alternatively: use sentence-transformers (no Ollama needed for embeddings)
```

### Get API keys (at least 1 required + Ollama for full coverage)
- **Groq:** https://console.groq.com/keys (free tier, 30k req/day)
- **Gemini:** https://makersuite.google.com/app/apikey (free tier, 1500 req/day)
- **OpenAI:** https://platform.openai.com/api-keys (pay-as-you-go, ~$1 covers 500K tokens)

### Configure .env
```bash
cp .env.example .env
# Edit .env, paste your API keys
```

## 2. RUN

### Start the AI service
```bash
cd ai_service/
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
```

### Visit http://localhost:8002/docs for the OpenAPI UI

### Optional: Start Telegram bot (separate process)
```bash
export TELEGRAM_BOT_TOKEN=...   # from @BotFather
python -m app.routers.telegram_bot
```

## 3. TEST IT

### Health check
```bash
curl http://localhost:8002/ai/health
# {"ok":true,"providers_configured":["groq","gemini","openai","ollama"],"tools_registered":16}
```

### Start a conversation + ask a question
```bash
# Start conv
CID=$(curl -sX POST http://localhost:8002/ai/conversations/start \
  -H "Content-Type: application/json" \
  -d '{"user_id":1,"source":"web"}' | jq .conversation_id)

# Ask
curl -sX POST http://localhost:8002/ai/chat \
  -H "Content-Type: application/json" \
  -d "{\"conversation_id\":$CID,\"user_id\":1,\"message\":\"Find COB-7 and show its packages\"}" \
  | jq
```

You should see the assistant call `find_scheme` then `list_packages` and reply with COB-7's details.

### Upload a document
```bash
curl -sX POST http://localhost:8002/ai/documents/upload \
  -F "file=@/path/to/contract.pdf" \
  -F "title=COB-7 Main Contract" \
  -F "document_type=contract" \
  -F "scheme_id=74" \
  -F "user_id=1"
```

Then check status:
```bash
curl http://localhost:8002/ai/documents/1/status | jq
# Watch extraction_status go: pending → processing → done
# embedding_status: pending → done
```

Now you can ask: "What does the COB-7 contract say about penalties?" and it'll do RAG.

## 4. FRONTEND INTEGRATION

Copy `frontend_page.tsx` → `frontend/app/ai/page.tsx`

Set the env var in `frontend/.env.local`:
```
NEXT_PUBLIC_AI_API_URL=http://localhost:8002
```

Visit http://localhost:3000/ai

## 5. THE 16 TOOLS (DB-backed)

The AI has these tools — no SQL injection possible, all parameterized:

1. `find_scheme` - fuzzy search schemes by name/code
2. `get_scheme_details` - full scheme details + lifecycle + packages
3. `get_scheme_timeline` - full lifecycle event history (every dated event)
4. `list_packages` - filterable list (by status, risk, scheme)
5. `get_progress_status` - S-curve data + forecast for a package
6. `analyze_delays` - find behind-schedule packages with reasons
7. `list_open_commitments` - open/overdue commitments with urgency
8. `list_approvals` - ad-hoc approvals (deviation/EOT/etc)
9. `get_risk_summary` - portfolio risk counts + by-rule breakdown
10. `get_correspondence` - letters in/out for a scheme/package
11. `get_record_notes` - observations/decisions/instructions
12. `compute_s_curve_variance` - schedule variance + trend
13. `get_capex_summary` - CAPEX plan vs actual
14. `search_documents` - **semantic search via pgvector** (RAG)
15. `get_tender_history` - tender cycle history (retender/RPN)
16. `get_today_dashboard` - portfolio counts + top risks + due commitments

## 6. STREAMING

The frontend uses Server-Sent Events. Event types streamed:

```js
{type: "task_type", value: "analysis"}        // classified
{type: "tool_call", name: "find_scheme", args: {...}}    // about to run tool
{type: "tool_result", name: "find_scheme", preview: "..."}  // tool done
{type: "token", text: "Yes "}                  // streaming reply
{type: "done", tokens: 234, cost_usd: 0.001, provider: "gemini", model: "gemini-2.5-flash", citations: {...}}
{type: "error", message: "..."}
```

Inspect tool calls in real-time in the UI — users see what the AI is doing, not just a spinner.

## 7. DEPLOYMENT (production)

### Cron job for nightly risk indicators (Sprint 7)
```cron
0 2 * * * /opt/pb/venv/bin/python /opt/pb/sprint7/compute_risks.py --db "postgresql://..."
```

### Systemd service for AI service
Create `/etc/systemd/system/project-brain-ai.service`:
```ini
[Unit]
Description=Project Brain AI Service
After=network.target postgresql.service

[Service]
Type=simple
User=brain
WorkingDirectory=/opt/pb/ai_service
EnvironmentFile=/opt/pb/ai_service/.env
ExecStart=/opt/pb/ai_service/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8002 --workers 2
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now project-brain-ai
```

### Systemd service for Telegram bot
Same pattern with `ExecStart=/opt/pb/ai_service/venv/bin/python -m app.routers.telegram_bot`

## 8. COST ESTIMATES (per 100 queries)

Assume average query: 2 tool calls, 800 input tokens, 400 output tokens per call.

| Provider | Cost per 100 queries |
|---|---|
| Groq (lookups) | ~$0.03 |
| Gemini (analysis) | ~$0.08 |
| OpenAI (reports) | ~$0.05 |
| Ollama (anything) | $0 |

**Total realistic monthly cost** for ~3000 queries: $1-3 USD.

## 9. SECURITY NOTES

- API keys live in `.env`, never commit
- Tools use **closed enums** for entities/columns → AI can't write SQL
- DB connection is **readonly** for tool calls — no destructive ops possible
- Document uploads stored in `UPLOAD_DIR` outside the web root — no direct serve
- Add reverse proxy auth (nginx + JWT) in front of port 8002 for production

## 10. WHAT TO ADD NEXT (Sprint 9)

- RBAC: enforce `user_scheme_access` on every tool call (per-user data scoping)
- Audit: log every AI query to `monitoring_log` (already partially done)
- Rate limit: 100 queries/user/hour (use slowapi)
- Tool: `update_*` write-back tools (currently AI is read-only)
- Multi-modal: accept images in chat (Gemini Vision for site photos)

---

**This bundle is production-ready for read-only AI Q&A + RAG.** Drop it in, set keys, point Next.js at it.
