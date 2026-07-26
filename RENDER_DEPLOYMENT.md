# Render Deployment

This repo is configured for one Render Web Service that runs:

- Project Brain backend on Render's `$PORT`
- AI service internally on `127.0.0.1:8002`

Use `render.yaml` as a Render Blueprint, or create the service manually with the same values.

## Service Settings

- Service type: Web Service
- Runtime: Docker
- Dockerfile path: `./Dockerfile.render`
- Docker context: `.`
- Plan: Free is OK for testing
- Health check path: `/api/health`
- Auto deploy: On

Do not choose Python runtime for this repo on Render. Use Docker, because the single service starts both the backend and AI service.

## Required Environment Variables

Set these in Render. Do not commit real secrets.

```text
DATABASE_URL=postgresql://neondb_owner:...@ep-restless-butterfly-aztann9v.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
PROJECT_BRAIN_DB_URL=postgresql://neondb_owner:...@ep-restless-butterfly-aztann9v.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
JWT_SECRET=<generate-long-random-secret>
PB_AUTH_SECRET=<same-or-another-long-random-secret>
SECRET_KEY=<same-or-another-long-random-secret>
CORS_ORIGINS=https://your-vercel-app.vercel.app,http://localhost:3000,http://127.0.0.1:3000
PB_AUTH_ENFORCE=1
JWT_EXPIRY_HOURS=12
AI_SERVICE_URL=http://127.0.0.1:8002
AI_DEFAULT_PROVIDER=groq
```

If Render has IPv6 connection trouble with Neon, use the same direct Neon host and append a current IPv4 `hostaddr` parameter:

```text
&hostaddr=52.76.128.157
```

Only use a `hostaddr` after testing, because Neon IPs can change. Prefer the normal direct Neon hostname first.

## AI Provider Keys

Set at least one cloud provider key in Render. Groq is the recommended first one for this project:

```text
GROQ_API_KEY=<your-groq-key>
GEMINI_API_KEY=<optional>
OPENAI_API_KEY=<optional>
CEREBRAS_API_KEY=<optional>
OPENROUTER_API_KEY=<optional>
```

Local Ollama is not available inside Render free service unless you run a separate Ollama service, so cloud keys are required for production AI chat.

## Vercel Frontend

In Vercel, set the frontend API variables to the Render service URL:

```text
NEXT_PUBLIC_API_BASE=https://your-render-service.onrender.com/api/v1
NEXT_PUBLIC_API_BASE_URL=https://your-render-service.onrender.com/api/v1
NEXT_PUBLIC_API_URL=https://your-render-service.onrender.com
NEXT_PUBLIC_AI_API_URL=https://your-render-service.onrender.com
NEXT_PUBLIC_AI_BASE=https://your-render-service.onrender.com
NEXT_PUBLIC_PB_MOCK=0
```

After changing Vercel environment variables, redeploy the Vercel frontend.

## Smoke Tests

After Render deploy finishes:

```bash
curl https://your-render-service.onrender.com/api/health
curl https://your-render-service.onrender.com/ai/health
curl https://your-render-service.onrender.com/api/v1/schemes/all
```

Expected:

- `/api/health` returns backend status ok.
- `/ai/health` shows at least one configured provider, for example `groq`.
- `/api/v1/schemes/all` returns scheme rows from Neon.
