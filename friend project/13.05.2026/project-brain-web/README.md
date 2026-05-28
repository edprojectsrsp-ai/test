# Project Brain Web

React + FastAPI migration of the Project Brain desktop app.

## Current Web Slice

- Login screen backed by existing `database.py` authentication.
- Main module navigation for Dashboard, Registration, Project Details, Ongoing Projects, Daily Progress, CAPEX, Schedule, Reports, Repository, and Admin Panel.
- Project Registration web add/list flow.
- Project Details and Appendix-2 read views.
- Ongoing project list from PostgreSQL.
- Daily Progress dashboard view:
  - Combined manpower/construction data entry table.
  - Project scope overview.
  - Cumulative performance snapshot.
- CAPEX saved-data viewer.
- Schedule import/activity viewer.
- Reports summary and Admin user/permission viewer.

The existing Tkinter app is unchanged and still contains the full original edit popups/workflows.

## Run

Start backend:

```powershell
& "D:\Python\Project Brain\project-brain-web\start_backend.cmd"
```

Start frontend:

```powershell
cd "D:\Python\Project Brain\project-brain-web\frontend"
& "C:\Program Files\nodejs\npm.cmd" run dev -- --port 5173
```

Open:

```text
http://127.0.0.1:5173
```

If Vite starts on another local port such as `5174`, use that URL. The backend allows both `5173` and `5174` by default.
