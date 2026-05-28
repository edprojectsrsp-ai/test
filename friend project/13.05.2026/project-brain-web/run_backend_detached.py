import os
import sys
import traceback
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
LOG_DIR = ROOT.parent

sys.path.insert(0, str(BACKEND))
os.chdir(ROOT)

log_file = open(LOG_DIR / "backend_8000_detached.log", "a", encoding="utf-8", buffering=1)
sys.stdout = log_file
sys.stderr = log_file

try:
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, app_dir=str(BACKEND), log_level="info")
except Exception:
    traceback.print_exc()
    raise
