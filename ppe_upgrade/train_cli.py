"""train_cli.py — the self-training loop closer + model version registry.

    python train_cli.py build-dataset --reviewed ppe_active_samples --seed datasets/ppe_seed --out datasets/ppe_v2
    python train_cli.py train --data datasets/ppe_v2/data.yaml --base yolo11n.pt --epochs 60
    python train_cli.py register --weights runs/train/exp/weights/best.pt --note "v2: +214 reviewed frames"
    python train_cli.py list | activate --version 3 | rollback

build-dataset merges the seed dataset with operator-REVIEWED active-learning
corrections (only samples whose .json status == 'reviewed' — pending ones are
excluded so unverified labels never poison training), deduplicates, splits
train/val, and writes data.yaml. train fine-tunes via ultralytics (lazy import;
--dry-run validates everything without a GPU). The registry is a JSON file by
default (zero infra) and mirrors to Postgres table ppe_model_versions when
PROJECT_BRAIN_DB_URL is set — the admin UI reads the same registry to
view/activate/remove weights.

Licensing note: ultralytics is AGPL-3.0. Internal plant deployment is fine;
if the ministry ever redistributes the service publicly, buy the Ultralytics
Enterprise license or swap to an Apache-2.0 detector (e.g. RT-DETR variants).
"""
from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import time
from typing import List, Optional

REGISTRY_PATH = os.environ.get("PPE_REGISTRY", "ppe_model_registry.json")
# MUST match app.ml.taxonomy.CANONICAL_CLASSES order exactly -- the review
# exporter writes label indices in this order, so data.yaml names must line up
# or training learns the wrong classes. Kept as a literal so the CLI stays
# standalone (no import of the backend package).
CLASS_NAMES = [
    "person",
    "helmet", "no_helmet",
    "vest", "no_vest",
    "gloves", "no_gloves",
    "goggles", "no_goggles",
    "boots", "no_boots",
    "harness", "no_harness",
    "mask", "no_mask",
    "smoking", "mobile_phone", "fire", "smoke", "vehicle",
]


# ---------------------------------------------------------------- registry
def _load_registry() -> dict:
    if os.path.exists(REGISTRY_PATH):
        with open(REGISTRY_PATH) as f:
            return json.load(f)
    return {"versions": [], "active": None}


def _save_registry(reg: dict) -> None:
    with open(REGISTRY_PATH, "w") as f:
        json.dump(reg, f, indent=2)
    _mirror_to_db(reg)


def _mirror_to_db(reg: dict) -> None:
    dsn = os.environ.get("PROJECT_BRAIN_DB_URL") or os.environ.get("DATABASE_URL")
    if not dsn:
        return
    try:
        import psycopg2
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS ppe_model_versions (
                    version int PRIMARY KEY, weights_path text, note text,
                    metrics jsonb, created_at timestamptz, is_active boolean
                )""")
            cur.execute("UPDATE ppe_model_versions SET is_active = false")
            for v in reg["versions"]:
                cur.execute("""
                    INSERT INTO ppe_model_versions (version, weights_path, note, metrics, created_at, is_active)
                    VALUES (%s,%s,%s,%s::jsonb,to_timestamp(%s),%s)
                    ON CONFLICT (version) DO UPDATE SET weights_path=EXCLUDED.weights_path,
                        note=EXCLUDED.note, metrics=EXCLUDED.metrics, is_active=EXCLUDED.is_active
                """, (v["version"], v["weights"], v.get("note", ""),
                      json.dumps(v.get("metrics", {})), v["ts"], v["version"] == reg["active"]))
        conn.close()
    except Exception:
        pass  # registry file remains the source of truth


# ------------------------------------------------------------ build-dataset
def build_dataset(reviewed_dir: str, seed_dir: Optional[str], out_dir: str,
                  val_split: float = 0.15, seed: int = 42) -> dict:
    random.seed(seed)
    pairs: List[tuple] = []  # (img_path, label_path, origin)

    if seed_dir and os.path.isdir(seed_dir):
        for root, _dirs, files in os.walk(seed_dir):
            for fn in files:
                if fn.lower().endswith((".jpg", ".jpeg", ".png")):
                    img = os.path.join(root, fn)
                    lbl = os.path.splitext(img)[0] + ".txt"
                    if os.path.exists(lbl):
                        pairs.append((img, lbl, "seed"))

    reviewed = skipped = 0
    for root, _dirs, files in os.walk(reviewed_dir or "."):
        for fn in files:
            if not fn.endswith(".json"):
                continue
            meta_path = os.path.join(root, fn)
            try:
                with open(meta_path) as f:
                    meta = json.load(f)
            except Exception:
                continue
            if meta.get("status") != "reviewed":          # pending never trains
                skipped += 1
                continue
            img, lbl = meta.get("image"), meta.get("labels")
            if img and lbl and os.path.exists(img) and os.path.exists(lbl):
                pairs.append((img, lbl, "reviewed"))
                reviewed += 1

    if not pairs:
        raise SystemExit("No training pairs found (need seed dataset and/or REVIEWED samples).")

    random.shuffle(pairs)
    n_val = max(1, int(len(pairs) * val_split))
    splits = {"val": pairs[:n_val], "train": pairs[n_val:]}
    for split, items in splits.items():
        img_d = os.path.join(out_dir, "images", split)
        lbl_d = os.path.join(out_dir, "labels", split)
        os.makedirs(img_d, exist_ok=True)
        os.makedirs(lbl_d, exist_ok=True)
        for i, (img, lbl, _origin) in enumerate(items):
            stem = f"{split}_{i:06d}"
            shutil.copy2(img, os.path.join(img_d, stem + os.path.splitext(img)[1].lower()))
            shutil.copy2(lbl, os.path.join(lbl_d, stem + ".txt"))

    yaml_path = os.path.join(out_dir, "data.yaml")
    with open(yaml_path, "w") as f:
        f.write(f"path: {os.path.abspath(out_dir)}\ntrain: images/train\nval: images/val\n"
                f"nc: {len(CLASS_NAMES)}\nnames: {json.dumps(CLASS_NAMES)}\n")
    stats = {"total": len(pairs), "train": len(splits["train"]), "val": len(splits["val"]),
             "reviewed_used": reviewed, "pending_excluded": skipped, "data_yaml": yaml_path}

    # AI Data Quality Manager pass: audit the freshly-built dataset and surface
    # dedup/blur/label/imbalance recommendations before anyone trains on it.
    try:
        from data_quality import audit as _dq_audit

        rep = _dq_audit(out_dir)
        stats["quality"] = {
            "duplicate_groups": len(rep.duplicates),
            "blurry": len(rep.blurry),
            "label_error_files": len(rep.label_errors),
            "imbalance_ratio": rep.imbalance_ratio,
            "recommendations": rep.recommendations,
        }
    except Exception as _e:  # never block dataset build on the audit
        stats["quality"] = {"skipped": str(_e)}

    print(json.dumps(stats, indent=2))
    return stats


# --------------------------------------------------------------------- train
def train(data_yaml: str, base: str = "yolo11n.pt", epochs: int = 60,
          imgsz: int = 640, dry_run: bool = False) -> Optional[str]:
    if not os.path.exists(data_yaml):
        raise SystemExit(f"data.yaml not found: {data_yaml}")
    if dry_run:
        print(json.dumps({"dry_run": True, "data": data_yaml, "base": base,
                          "epochs": epochs, "imgsz": imgsz, "ok": True}))
        return None
    from ultralytics import YOLO   # lazy — AGPL note in module docstring
    model = YOLO(base)
    results = model.train(data=data_yaml, epochs=epochs, imgsz=imgsz,
                          patience=15, device=None)  # device auto (CPU ok, slow)
    best = str(getattr(results, "save_dir", "runs/train")) + "/weights/best.pt"
    print(f"best weights: {best}")
    return best


# ------------------------------------------------------------------ evaluate
def evaluate(weights: str, data_yaml: str, imgsz: int = 640,
             dry_run: bool = False) -> dict:
    """Validate a checkpoint on the val split -> {mAP50, mAP50_95, precision,
    recall}. This is the objective signal the deploy gate compares on."""
    if dry_run:
        return {"dry_run": True, "map50": 0.0, "map50_95": 0.0}
    if not os.path.exists(weights):
        raise SystemExit(f"weights not found: {weights}")
    from ultralytics import YOLO  # lazy

    model = YOLO(weights)
    res = model.val(data=data_yaml, imgsz=imgsz, verbose=False)
    box = getattr(res, "box", None)
    metrics = {
        "map50": float(getattr(box, "map50", 0.0) or 0.0),
        "map50_95": float(getattr(box, "map", 0.0) or 0.0),
        "precision": float(getattr(box, "mp", 0.0) or 0.0),
        "recall": float(getattr(box, "mr", 0.0) or 0.0),
        "evaluated_at": time.time(),
    }
    return metrics


def _active_metrics(reg: dict) -> dict:
    active = reg.get("active")
    for v in reg.get("versions", []):
        if v["version"] == active:
            return v.get("metrics", {}) or {}
    return {}


def gate(new_metrics: dict, active_metrics: dict, key: str = "map50",
         min_delta: float = 0.0) -> dict:
    """Champion vs challenger. Returns {promote: bool, reason, delta}.

    Promote only if the challenger's chosen metric beats the champion's by at
    least `min_delta`. If there is no champion yet, the challenger wins by
    default (bootstrap). Missing new metrics => never auto-promote."""
    if not new_metrics or new_metrics.get("dry_run"):
        return {"promote": False, "reason": "no eval metrics for challenger", "delta": 0.0}
    if not active_metrics:
        return {"promote": True, "reason": "no active champion (bootstrap)", "delta": 0.0}
    new_v = float(new_metrics.get(key, 0.0))
    old_v = float(active_metrics.get(key, 0.0))
    delta = round(new_v - old_v, 4)
    if delta >= min_delta:
        return {"promote": True, "reason": f"{key} +{delta} >= {min_delta}", "delta": delta}
    return {"promote": False, "reason": f"{key} {delta} < {min_delta} (regression)", "delta": delta}


# ---------------------------------------------------------- register/activate
def register(weights: str, note: str = "", metrics: Optional[dict] = None,
             activate_now: bool = True, gate_on: bool = False,
             gate_key: str = "map50", gate_min_delta: float = 0.0) -> dict:
    if not os.path.exists(weights):
        raise SystemExit(f"weights not found: {weights}")
    reg = _load_registry()
    version = (max((v["version"] for v in reg["versions"]), default=0)) + 1
    entry = {"version": version, "weights": os.path.abspath(weights),
             "note": note, "metrics": metrics or {}, "ts": time.time()}
    reg["versions"].append(entry)

    decision = None
    if gate_on:
        # Automated deploy gate: only activate if the challenger beats champion.
        decision = gate(metrics or {}, _active_metrics(reg), gate_key, gate_min_delta)
        entry["gate"] = decision
        if decision["promote"]:
            reg["active"] = version
    elif activate_now:
        reg["active"] = version

    _save_registry(reg)
    out = {"registered": version, "active": reg["active"]}
    if decision is not None:
        out["gate"] = decision
    print(json.dumps(out, indent=2))
    return entry


def set_active(version: Optional[int]) -> None:
    reg = _load_registry()
    versions = {v["version"] for v in reg["versions"]}
    if version is None:  # rollback = previous version
        ordered = sorted(versions)
        if reg["active"] in ordered and ordered.index(reg["active"]) > 0:
            version = ordered[ordered.index(reg["active"]) - 1]
        else:
            raise SystemExit("No earlier version to roll back to.")
    if version not in versions:
        raise SystemExit(f"Unknown version {version}. Known: {sorted(versions)}")
    reg["active"] = version
    _save_registry(reg)
    print(json.dumps({"active": version}))


def list_versions() -> None:
    reg = _load_registry()
    for v in reg["versions"]:
        flag = "  <== ACTIVE" if v["version"] == reg["active"] else ""
        print(f"v{v['version']:>3}  {time.strftime('%Y-%m-%d %H:%M', time.localtime(v['ts']))}  "
              f"{v['weights']}  {v.get('note','')}{flag}")
    if not reg["versions"]:
        print("(registry empty)")


def main() -> None:
    ap = argparse.ArgumentParser(description="PPE self-training loop")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build-dataset")
    b.add_argument("--reviewed", required=True)
    b.add_argument("--seed", default=None)
    b.add_argument("--out", required=True)
    b.add_argument("--val-split", type=float, default=0.15)

    t = sub.add_parser("train")
    t.add_argument("--data", required=True)
    t.add_argument("--base", default="yolo11n.pt")
    t.add_argument("--epochs", type=int, default=60)
    t.add_argument("--imgsz", type=int, default=640)
    t.add_argument("--dry-run", action="store_true")

    e = sub.add_parser("evaluate")
    e.add_argument("--weights", required=True)
    e.add_argument("--data", required=True)
    e.add_argument("--imgsz", type=int, default=640)
    e.add_argument("--dry-run", action="store_true")

    r = sub.add_parser("register")
    r.add_argument("--weights", required=True)
    r.add_argument("--note", default="")
    r.add_argument("--no-activate", action="store_true")
    # automated deploy gate: evaluate + only promote if it beats the champion
    r.add_argument("--gate", action="store_true",
                   help="only activate if it beats the active model")
    r.add_argument("--data", default=None,
                   help="val data.yaml to evaluate the challenger on (with --gate)")
    r.add_argument("--gate-key", default="map50")
    r.add_argument("--gate-min-delta", type=float, default=0.0)

    a = sub.add_parser("activate")
    a.add_argument("--version", type=int, required=True)

    sub.add_parser("rollback")
    sub.add_parser("list")

    args = ap.parse_args()
    if args.cmd == "build-dataset":
        build_dataset(args.reviewed, args.seed, args.out, args.val_split)
    elif args.cmd == "train":
        train(args.data, args.base, args.epochs, args.imgsz, args.dry_run)
    elif args.cmd == "evaluate":
        print(json.dumps(evaluate(args.weights, args.data, args.imgsz, args.dry_run), indent=2))
    elif args.cmd == "register":
        metrics = None
        if args.gate and args.data:
            metrics = evaluate(args.weights, args.data, dry_run=False)
        register(args.weights, args.note, metrics=metrics,
                 activate_now=not args.no_activate, gate_on=args.gate,
                 gate_key=args.gate_key, gate_min_delta=args.gate_min_delta)
    elif args.cmd == "activate":
        set_active(args.version)
    elif args.cmd == "rollback":
        set_active(None)
    elif args.cmd == "list":
        list_versions()


if __name__ == "__main__":
    main()
