# PPE Agent - Windows installer

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
- CPython (the same minor version you want on the target - recorded into
  `PYTHON_VERSION` in the payload and checked at install time)
- Node 20+ (only for `-IncludeConsole`)

No installer compiler, and no third-party service wrapper.

```powershell
# CPU-only, ~1.5 GB
.\build.ps1 -IncludeWeights -IncludeConsole

# CUDA 12.1 torch - use this if the plant PC has an NVIDIA GPU
.\build.ps1 -Gpu -IncludeWeights -IncludeConsole

# package it
.\package.ps1         # -> dist\PPEAgent-0.2.0-cpu.zip (+ .sha256)
```

`build.ps1` also downloads the matching CPython installer into `redist\`, so
the target PC needs no internet during installation.

### Why a ZIP and a script, not a setup.exe

Inno Setup now ships **only** through GitHub releases, and NSIS only through
SourceForge. Both hosts are blocked on many plant and corporate networks -
including the one this was built on - so neither compiler can be obtained
where it is needed. `setup.iss` is kept for anyone who does have Inno Setup
(`iscc setup.iss`), but it is not the supported path.

A script also has a real advantage here: an operator can **read** it before
running something that registers a Windows service and opens a firewall port.

### Other deliberate choices

- **A bundled venv, not PyInstaller.** Freezing torch and ultralytics means
  fighting hidden imports, CUDA DLL discovery and ultralytics' runtime
  `importlib` calls, and the result breaks on the next ultralytics release. A
  venv is larger but predictable; on a PC installed once, disk is cheap.
- **A native service via pywin32, not NSSM or WinSW.** Both are binaries from
  download hosts that plant networks block. pywin32 comes from PyPI, which
  must already be reachable or nothing installs at all. See
  `backend/app/service_win.py`.

## Installing

Extract the ZIP on the plant PC, then in an **elevated** PowerShell:

```powershell
cd "<the extracted folder>"
.\install.ps1
```

It asks a few questions; Enter accepts the defaults. For an unattended
rollout:

```powershell
.\install.ps1 -CloudUrl https://ppe.example.com -JoinCode ABC123 `
              -AgentName rsp-plant-01 -LanAccess -Unattended
```

If PowerShell refuses to run it, `Set-ExecutionPolicy -Scope Process -Bypass`
once in the same window.

It asks for:

- **Cloud sync URL** - usually the hosted PPE backend, e.g.
  `https://your-app.onrender.com`
- **Join code** - the cloud service's `PPE_ENROLL_CODE`. This PC swaps it for
  its own credentials on first start, so there is nothing to configure on the
  server per machine
- **Control room URL** - the Vercel web dashboard operators open in the
  browser; also added to the agent's allowed CORS origins, which the browser
  requires since an HTTPS page is calling `http://127.0.0.1`
- **Sync mode** - manual (default) or every 4 hours

Leave the cloud fields blank to run fully offline and configure later.

### Matching cloud config

Before installing the agent, configure the hosted PPE backend with matching
values:

```text
PPE_ROLE=cloud
PPE_ENROLL_CODE=<the join code you type into the installer>
PPE_DATABASE_URL=<Postgres URL>
PPE_CORS_ORIGINS=https://<your-vercel-domain>
```

The cloud role needs Postgres. On free Render web services, local SQLite is
ephemeral and is wiped on deploy or restart.

## After installing

- Services: `PPEAgent` (+ `PPEConsole` if wall/phone access is on),
  auto-start, restart-on-crash
- API: `http://127.0.0.1:8004` (`/docs` for the browsable API)
- Config: `<install>\.env` - restart the service after editing
- Data: `<install>\data\` - `ppe.db`, captures, recordings, weights, logs

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
upserts on them. A batch interrupted halfway can simply be pushed again - only
rows the cloud actually acknowledged are marked as sent.

## Wall TVs, phones, and the APK

Choose "Allow wall TVs and phones" during setup (or set `PPE_HOST=0.0.0.0` in
`.env`) and the installer additionally:

- registers **`PPEConsole`**, serving the control room on port 3000
- generates a random **LAN key** into `PPE_LAN_TOKEN`
- opens the firewall for both ports on Private/Domain profiles

Then a wall TV just opens `http://<plant-pc>:3000/ppe/desktop/?tab=wall` in its
browser. **Nothing to install on the TV.**

### Why the console is served locally rather than from the cloud

A browser will let an HTTPS page call `http://127.0.0.1` — loopback is treated
as a trustworthy origin — but **never** a plain-http LAN address. So a TV
loading the Vercel site could not reach this agent no matter how it was
configured. Serving the console from the plant PC puts the page and the agent on
the same scheme, which is what makes a wall display possible at all.

| Where | Opens | Gets |
|---|---|---|
| Plant PC | Vercel URL *or* `localhost:3000` | everything |
| Wall TV | `http://<plant-pc>:3000` | everything, incl. live video |
| Phone on plant WiFi | `http://<plant-pc>:3000` | everything |
| Phone off-site | Vercel URL | violations + analytics only |

### APK

The APK is a shell around a URL, not a bundled copy — see `capacitor.config.ts`.
Point it at the cloud for off-site use, or at the plant PC for on-site use:

```powershell
cd ..\..\Project-brain
.\scripts\build-apk.ps1 -AppUrl https://your-app.vercel.app
.\scripts\build-apk.ps1 -AppUrl http://192.168.1.50:3000   # on-site, full console
```

Needs **JDK 17+** and the Android SDK (`ANDROID_HOME`). The script checks both
up front and fails with a useful message rather than a Gradle stack trace.

## Assigning violations

Every violation can be given an owner, a due date and a close-out note, from the
alert detail view on the plant console. Overdue assignments show a red badge on
the cards and on the wall ticker.

Assignment happens **on the agent** — that is where the safety officer is — and
rides to the cloud on the next push, so management sees who owns what. Changing
an assignment clears `synced_at`, which puts the row back in the outbound queue;
a violation pushed yesterday and assigned today re-pushes rather than leaving a
stale, unowned copy on the dashboard.

```powershell
curl http://127.0.0.1:8004/api/violations/assignees   # directory
curl http://127.0.0.1:8004/api/violations/workload    # who is sitting on what
```

## Notes

- **Browser:** use Chrome or Edge. An HTTPS page calling `http://127.0.0.1`
  triggers Chrome's Private Network Access preflight, which the agent answers;
  Firefox has been inconsistent about localhost mixed content.
- **Uninstalling** removes the service but **keeps `data\`** - that is the
  safety record and the source of everything the cloud displays. Delete it
  deliberately, separately.
- **Upgrading** keeps your existing `.env` and writes the new template beside it
  as `.env.new`.
- **Rotating the join code:** change `PPE_ENROLL_CODE` on the cloud and
  redeploy. Agents already joined keep working - they hold their own tokens.
  Revoke one agent without deleting its history by setting
  `sync_agents.enabled = false`.
