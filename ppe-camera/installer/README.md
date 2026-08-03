# PPE Agent — Windows installer

Packages the PPE detection stack as a Windows service for a plant PC, so
inference runs on that machine's GPU/CPU instead of a 512 MB cloud instance.

## Why this exists

Live streaming and model inference never fit on the free hosted tier: torch
alone is ~400 MB resident before a frame is decoded. The split is now:

| | Plant PC (this installer) | Cloud (Render/Vercel) |
|---|---|---|
| Cameras, RTSP, live view | yes | no |
| YOLO inference, tracking, re-ID | yes | no |
| Recording, retention, training | yes | no |
| Violations dashboard | yes | yes |
| Evidence stills, GIFs, clips | full resolution, kept | 640px thumbnail only |

The agent listens on `127.0.0.1` only and makes **outbound** HTTPS calls to push
violations. The cloud never connects inward, so no firewall change, no port
forward and no tunnel is required.

## Building

Requires, on the **build** machine:

- Windows x64
- CPython (the same minor version you want on the target — recorded into
  `PYTHON_VERSION` in the payload and checked at install time)
- [Inno Setup 6](https://jrsoftware.org/isdl.php)
- [`nssm.exe`](https://nssm.cc/download) (64-bit) placed in this folder

```powershell
# CPU-only, ~800 MB
.\build.ps1

# CUDA 12.1 torch, ~2.5 GB — use this if the plant PC has an NVIDIA GPU
.\build.ps1 -Gpu -IncludeWeights

# then
iscc setup.iss        # -> Output\PPEAgent-Setup-0.2.0.exe
```

Optionally drop `python-3.12.x-amd64.exe` into `redist\` so the target PC needs
no internet access during installation.

> **Why a bundled venv and not PyInstaller?** Freezing torch and ultralytics
> means fighting hidden imports, CUDA DLL discovery and ultralytics' runtime
> `importlib` calls, and the result breaks on the next ultralytics release. A
> venv is larger but predictable. On a PC that is installed once, disk is the
> cheap resource.

## Installing

The wizard asks for:

- **Cloud URL** — e.g. `https://your-app.onrender.com`
- **Agent ID** and **token** — must match an entry in the cloud service's
  `PPE_SYNC_AGENTS` (`agentid:token`, comma-separated)
- **Control room URL** — the web dashboard; also added to the agent's allowed
  CORS origins, which the browser requires since an HTTPS page is calling
  `http://127.0.0.1`
- **Sync mode** — manual (default) or every 4 hours

Leave the cloud fields blank to run fully offline and configure later.

## After installing

- Service: `PPEAgent`, auto-start, restarts on crash
- API: `http://127.0.0.1:8004` (`/docs` for the browsable API)
- Config: `<install>\.env` — restart the service after editing
- Data: `<install>\data\` — `ppe.db`, captures, recordings, weights, logs

```powershell
Get-Service PPEAgent
Restart-Service PPEAgent
Get-Content "<install>\data\agent.err.log" -Tail 50
```

## Pushing violations

Nothing leaves the PC until asked. From the control room, or directly:

```powershell
# what is queued
curl http://127.0.0.1:8004/api/sync/status

# send everything
curl -X POST http://127.0.0.1:8004/api/sync/push -H "Content-Type: application/json" -d "{}"

# send only one camera, only today, at most 50
curl -X POST http://127.0.0.1:8004/api/sync/push -H "Content-Type: application/json" ^
     -d "{\"camera_id\":\"cam-1\",\"since\":\"2026-08-03\",\"limit\":50}"

# preview without sending
curl -X POST http://127.0.0.1:8004/api/sync/push -H "Content-Type: application/json" -d "{\"dry_run\":true}"
```

A push sends the violation record plus a 640px annotated thumbnail. Full-
resolution stills, evidence GIFs and video clips never leave the plant PC.

Re-pushing is safe: violation IDs are generated on the agent, so the cloud
upserts on them. A batch interrupted halfway can simply be pushed again — only
rows the cloud actually acknowledged are marked as sent.

## Notes

- **Browser:** use Chrome or Edge. An HTTPS page calling `http://127.0.0.1`
  triggers Chrome's Private Network Access preflight, which the agent answers;
  Firefox has been inconsistent about localhost mixed content.
- **Uninstalling** removes the service but **keeps `data\`** — that is the
  safety record and the source of everything the cloud displays. Delete it
  deliberately, separately.
- **Upgrading** keeps your existing `.env` and writes the new template beside it
  as `.env.new`.
- **Rotating a token:** update `PPE_SYNC_AGENTS` on the cloud and `.env` here,
  then restart the service. Revoke without deleting history by setting
  `sync_agents.enabled = false`.
