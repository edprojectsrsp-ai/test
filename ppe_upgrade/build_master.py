"""build_master.py -- one command: download -> merge -> clean -> train -> gate.

Ties the whole Master-Dataset arm together:

  1. fetch the top-N public datasets via dataset_registry (skips any whose
     credentials aren't set, and reports which)
  2. MERGE them into one unified YOLO dataset, remapping every dataset's own
     class indices onto our canonical taxonomy (the hard part -- each dataset
     numbers its classes differently; we key off class *names* via the alias
     table, so heterogeneous sources line up)
  3. run the AI Data Quality Manager (dedup / blur / label / imbalance)
  4. train (or --dry-run to validate wiring with no GPU)
  5. evaluate + register through the champion/challenger deploy gate

Usage:
  # once ROBOFLOW_API_KEY / KAGGLE creds are set, on a GPU box:
  python ppe_upgrade/build_master.py --top 5 --out data/master --epochs 60
  # validate the whole chain with no creds / no GPU:
  python ppe_upgrade/build_master.py --top 5 --out data/master --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys

import dataset_registry as reg
import data_quality
import train_cli


# ---- canonical class mapping (reuse taxonomy if importable, else fallback) --
def _load_alias_map():
    """Return (canonical_classes:list, alias:dict raw_lower->canonical)."""
    here = os.path.dirname(os.path.abspath(__file__))
    backend = os.path.join(here, "..", "ppe-camera", "backend")
    sys.path.insert(0, backend)
    try:
        from app.ml import taxonomy  # the single source of truth
        return list(taxonomy.CANONICAL_CLASSES), dict(taxonomy.ALIASES)
    except Exception:
        # standalone fallback mirrors train_cli.CLASS_NAMES order
        classes = train_cli.CLASS_NAMES
        alias = {c: c for c in classes}
        alias.update({"hardhat": "helmet", "hard-hat": "helmet", "head": "no_helmet",
                      "safety-vest": "vest", "no-helmet": "no_helmet"})
        return classes, alias


def _canon(raw: str, alias: dict) -> str | None:
    key = raw.strip().lower().replace(" ", "-")
    return alias.get(key) or alias.get(key.replace("-", "_"))


def _read_names(data_yaml: str) -> list[str]:
    names: list[str] = []
    with open(data_yaml) as f:
        for line in f:
            line = line.strip()
            if line.startswith("names:"):
                rest = line.split("names:", 1)[1].strip()
                if rest.startswith("["):
                    names = [x.strip().strip("'\"") for x in rest.strip("[]").split(",") if x.strip()]
    return names


def merge_datasets(download_dir: str, out_dir: str, classes: list[str], alias: dict) -> dict:
    """Merge every downloaded YOLO dataset under download_dir into out_dir,
    remapping class indices to the canonical order. Drops boxes whose class
    can't be mapped (logged), so we never train on ambiguous labels."""
    cls_to_id = {c: i for i, c in enumerate(classes)}
    img_out = os.path.join(out_dir, "images", "all")
    lbl_out = os.path.join(out_dir, "labels", "all")
    os.makedirs(img_out, exist_ok=True)
    os.makedirs(lbl_out, exist_ok=True)

    stats = {"datasets": 0, "images": 0, "boxes_kept": 0, "boxes_dropped": 0, "unmapped": {}}
    for ds in sorted(os.listdir(download_dir)) if os.path.isdir(download_dir) else []:
        ds_dir = os.path.join(download_dir, ds)
        yaml = os.path.join(ds_dir, "data.yaml")
        local_names = _read_names(yaml) if os.path.exists(yaml) else []
        stats["datasets"] += 1
        img_root, lbl_root = data_quality._roots(ds_dir)
        for img, lbl in data_quality._iter_pairs(ds_dir):
            base = f"{ds}__{os.path.splitext(os.path.basename(img))[0]}"
            shutil.copy2(img, os.path.join(img_out, base + os.path.splitext(img)[1].lower()))
            stats["images"] += 1
            if lbl is None:
                continue
            out_rows = []
            rows, _errs = data_quality._parse_label(lbl)
            for cid, cx, cy, w, h in rows:
                raw = local_names[cid] if 0 <= cid < len(local_names) else str(cid)
                canon = _canon(raw, alias)
                if canon is None or canon not in cls_to_id:
                    stats["boxes_dropped"] += 1
                    stats["unmapped"][raw] = stats["unmapped"].get(raw, 0) + 1
                    continue
                out_rows.append(f"{cls_to_id[canon]} {cx} {cy} {w} {h}")
                stats["boxes_kept"] += 1
            if out_rows:
                with open(os.path.join(lbl_out, base + ".txt"), "w") as f:
                    f.write("\n".join(out_rows) + "\n")

    with open(os.path.join(out_dir, "data.yaml"), "w") as f:
        f.write(f"path: {os.path.abspath(out_dir)}\ntrain: images/all\nval: images/all\n"
                f"nc: {len(classes)}\nnames: {json.dumps(classes)}\n")
    return stats


def main() -> None:
    ap = argparse.ArgumentParser(description="Master dataset build + train orchestrator")
    ap.add_argument("--top", type=int, default=5, help="how many registry datasets to fetch")
    ap.add_argument("--out", default="data/master")
    ap.add_argument("--downloads", default="data/downloads")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--base", default="yolo12n.pt")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    classes, alias = _load_alias_map()
    names = [d.name for d in reg.REGISTRY][: args.top]

    # 1. fetch
    print("== 1. fetch datasets ==")
    fetched, skipped = [], []
    for n in names:
        res = reg.fetch(n, args.downloads)
        (fetched if res.get("ok") else skipped).append({n: res})
        print(f"  {n}: {'OK' if res.get('ok') else res.get('reason')}")
    if skipped and not args.dry_run:
        print("\nMissing credentials for:", [list(s)[0] for s in skipped])
        print("Set ROBOFLOW_API_KEY and/or KAGGLE_USERNAME+KAGGLE_KEY, then re-run.")

    # 2. merge
    print("== 2. merge -> canonical taxonomy ==")
    merge_stats = merge_datasets(args.downloads, args.out, classes, alias)
    print("  ", json.dumps(merge_stats))

    # 3. quality audit
    print("== 3. data quality ==")
    try:
        rep = data_quality.audit(args.out)
        for r in rep.recommendations:
            print("   -", r)
    except Exception as e:
        print("   (skipped:", e, ")")

    # 4. train
    print("== 4. train ==")
    best = train_cli.train(os.path.join(args.out, "data.yaml"), args.base,
                           args.epochs, args.imgsz, dry_run=args.dry_run)

    # 5. evaluate + gate
    print("== 5. evaluate + deploy gate ==")
    if args.dry_run or not best:
        print("   dry-run: skipping evaluate/register (no weights produced).")
    else:
        metrics = train_cli.evaluate(best, os.path.join(args.out, "data.yaml"), args.imgsz)
        train_cli.register(best, note=f"master top{args.top}", metrics=metrics,
                           gate_on=True, gate_key="map50")


if __name__ == "__main__":
    main()
