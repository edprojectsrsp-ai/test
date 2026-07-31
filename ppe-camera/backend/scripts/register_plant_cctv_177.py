"""Register plant-cctv-177 snapshot feed used for local PPE testing.

Credentials default to the lab camera; override with env:
  PPE_PLANT_HOST, PPE_PLANT_USER, PPE_PLANT_PASS, PPE_PLANT_SNAPSHOT_PATH
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("PPE_API", "http://127.0.0.1:8004").rstrip("/")
HOST = os.environ.get("PPE_PLANT_HOST", "122.185.162.177")
USER = os.environ.get("PPE_PLANT_USER", "admin")
PASS = os.environ.get("PPE_PLANT_PASS", "admin@123")
SNAP = os.environ.get(
    "PPE_PLANT_SNAPSHOT_PATH",
    f"http://{HOST}/cgi-bin/snapshot.cgi",
)
CAM_ID = os.environ.get("PPE_PLANT_CAMERA_ID", "plant-cctv-177")


def req(method: str, path: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    r = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if body is not None else {},
    )
    with urllib.request.urlopen(r, timeout=30) as resp:
        raw = resp.read().decode("utf-8") or "{}"
        return json.loads(raw)


def main() -> int:
    payload = {
        "camera_id": CAM_ID,
        "source_kind": "snapshot",
        "source_kwargs": {
            "url": SNAP,
            "username": USER,
            "password": PASS,
            "poll_interval": 1.0,
        },
        "required_ppe": ["helmet", "vest"],
        "fps_limit": 2.0,
        "hazards_enabled": True,
        "pose_enabled": False,
    }
    try:
        try:
            urllib.request.urlopen(
                urllib.request.Request(f"{API}/api/cameras/{CAM_ID}", method="DELETE"),
                timeout=15,
            )
        except Exception:
            pass
        status = req("POST", "/api/cameras", payload)
        print("added:", json.dumps(status, indent=2))
        started = req("POST", f"/api/cameras/{CAM_ID}/start")
        print("started:", json.dumps(started, indent=2))
        # Ensure absence-based violations match live red overlay
        try:
            rule = req(
                "PUT",
                f"/api/cameras/{CAM_ID}/detection-rule",
                {"infer_missing_from_absence": True},
            )
            print("detection_rule:", json.dumps(rule, indent=2))
        except Exception as e:
            print("detection-rule note:", e)
        return 0
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, e.read().decode("utf-8", "replace"), file=sys.stderr)
        return 1
    except Exception as e:
        print("error:", e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
