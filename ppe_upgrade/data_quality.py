"""data_quality.py -- the AI Data Quality Manager.

Sits between the Master Dataset and the training pipeline. Given a YOLO-format
dataset directory (images/ + labels/ with a data.yaml or an explicit class
list), it audits quality and emits an actionable report:

  - Duplicate / near-duplicate images     (8x8 average perceptual hash + Hamming)
  - Blurry / low-quality images           (variance of Laplacian; cv2 optional,
                                            falls back to a numpy gradient proxy)
  - Corrupt / unreadable images
  - Label sanity errors                    (out-of-range coords, bad class ids,
                                            zero-area boxes, images with no label,
                                            labels with no image)
  - Class-distribution / imbalance stats   (per-class box counts, imbalance ratio)
  - Recommendations                        (which classes need more data, what to
                                            drop, whether to rebalance)

Design:
  - No hard dependency on cv2/numpy/PIL. It uses whichever is available and
    degrades gracefully, so it runs in CI and on a bare box. Image *decoding*
    needs Pillow OR cv2; if neither is present it still does label + pairing +
    filename-hash audits and says so.
  - Read-only by default. `apply_cleanup()` writes a *new* cleaned dataset dir;
    it never mutates the input. Nothing is deleted in place.

CLI:
    python data_quality.py audit  --data datasets/ppe_v2 [--json report.json]
    python data_quality.py clean  --data datasets/ppe_v2 --out datasets/ppe_v2_clean \
                                  [--drop-dupes] [--drop-blurry] [--blur-thresh 60]
"""
from __future__ import annotations

import argparse
import json
import os
from collections import Counter, defaultdict
from dataclasses import dataclass, field, asdict
from typing import Optional

IMG_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


# ---------------------------------------------------------------- optional deps
def _try_numpy():
    try:
        import numpy as np  # noqa
        return np
    except Exception:
        return None


def _load_gray(path: str):
    """Return a 2D grayscale array (numpy) or None if we can't decode."""
    np = _try_numpy()
    if np is None:
        return None
    # Prefer Pillow (pure-ish, widely present); fall back to cv2.
    try:
        from PIL import Image

        with Image.open(path) as im:
            return np.asarray(im.convert("L"), dtype="float32")
    except Exception:
        pass
    try:
        import cv2

        img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        return None if img is None else img.astype("float32")
    except Exception:
        return None


# ------------------------------------------------------------------ perceptual
def average_hash(gray, hash_size: int = 8) -> Optional[int]:
    np = _try_numpy()
    if np is None or gray is None:
        return None
    h, w = gray.shape[:2]
    ys = np.linspace(0, h - 1, hash_size).astype(int)
    xs = np.linspace(0, w - 1, hash_size).astype(int)
    small = gray[np.ix_(ys, xs)]
    bits = (small > small.mean()).flatten()
    value = 0
    for b in bits:
        value = (value << 1) | int(b)
    return value


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def laplacian_variance(gray) -> Optional[float]:
    """Focus measure. Low variance == blurry. cv2 if present, else numpy proxy."""
    np = _try_numpy()
    if np is None or gray is None:
        return None
    try:
        import cv2

        return float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except Exception:
        # numpy 4-neighbour Laplacian proxy
        lap = (
            -4 * gray
            + np.roll(gray, 1, 0)
            + np.roll(gray, -1, 0)
            + np.roll(gray, 1, 1)
            + np.roll(gray, -1, 1)
        )
        return float(lap.var())


# --------------------------------------------------------------------- dataset
def _read_classes(data_dir: str) -> list[str]:
    """Best-effort read of class names from data.yaml; else infer count."""
    yaml_path = os.path.join(data_dir, "data.yaml")
    if os.path.exists(yaml_path):
        names: list[str] = []
        with open(yaml_path) as f:
            txt = f.read()
        # tolerate both `names: [a, b]` and yaml list; we parse loosely w/o pyyaml
        for line in txt.splitlines():
            line = line.strip()
            if line.startswith("names:"):
                rest = line.split("names:", 1)[1].strip()
                if rest.startswith("["):
                    inner = rest.strip("[]")
                    names = [x.strip().strip("'\"") for x in inner.split(",") if x.strip()]
        if names:
            return names
    return []


def _roots(data_dir: str) -> tuple[str, str]:
    """Return (img_root, lbl_root), tolerating a flat layout."""
    img_root = os.path.join(data_dir, "images")
    lbl_root = os.path.join(data_dir, "labels")
    if not os.path.isdir(img_root):  # flat layout fallback
        img_root = data_dir
        lbl_root = data_dir
    return img_root, lbl_root


def _iter_pairs(data_dir: str):
    """Yield (image_path, label_path_or_None) across images/ subtree."""
    img_root, lbl_root = _roots(data_dir)
    for root, _dirs, files in os.walk(img_root):
        for fn in files:
            if fn.lower().endswith(IMG_EXTS):
                img = os.path.join(root, fn)
                rel = os.path.relpath(img, img_root)
                lbl = os.path.join(lbl_root, os.path.splitext(rel)[0] + ".txt")
                yield img, (lbl if os.path.exists(lbl) else None)


def _parse_label(path: str):
    """Yield (cls_id, cx, cy, w, h) rows; raise-free, returns errors list too."""
    rows, errs = [], []
    try:
        with open(path) as f:
            for i, line in enumerate(f, 1):
                parts = line.split()
                if not parts:
                    continue
                if len(parts) < 5:
                    errs.append(f"line {i}: expected >=5 fields, got {len(parts)}")
                    continue
                try:
                    cid = int(float(parts[0]))
                    cx, cy, w, h = (float(x) for x in parts[1:5])
                except ValueError:
                    errs.append(f"line {i}: non-numeric field")
                    continue
                for name, v in (("cx", cx), ("cy", cy), ("w", w), ("h", h)):
                    if not (0.0 <= v <= 1.0):
                        errs.append(f"line {i}: {name}={v} out of [0,1]")
                if w <= 0 or h <= 0:
                    errs.append(f"line {i}: zero/negative area box")
                rows.append((cid, cx, cy, w, h))
    except Exception as e:
        errs.append(f"unreadable: {e}")
    return rows, errs


@dataclass
class QualityReport:
    data_dir: str
    n_images: int = 0
    n_labeled: int = 0
    n_unlabeled: int = 0
    n_orphan_labels: int = 0
    n_corrupt: int = 0
    class_names: list[str] = field(default_factory=list)
    class_box_counts: dict[str, int] = field(default_factory=dict)
    imbalance_ratio: float = 0.0
    duplicates: list[list[str]] = field(default_factory=list)  # groups of paths
    blurry: list[dict] = field(default_factory=list)           # {path, score}
    label_errors: list[dict] = field(default_factory=list)     # {path, errors}
    bad_class_ids: list[dict] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    decoding_available: bool = True

    def to_dict(self) -> dict:
        return asdict(self)


def audit(data_dir: str, blur_thresh: float = 60.0, phash_dist: int = 6) -> QualityReport:
    classes = _read_classes(data_dir)
    rep = QualityReport(data_dir=data_dir, class_names=classes)

    hashes: dict[str, int] = {}
    box_counts: Counter = Counter()
    n_classes = len(classes)
    np = _try_numpy()
    rep.decoding_available = np is not None

    labeled_images = set()

    for img, lbl in _iter_pairs(data_dir):
        rep.n_images += 1
        gray = _load_gray(img)
        if np is not None and gray is None:
            rep.n_corrupt += 1

        # blur
        if gray is not None:
            score = laplacian_variance(gray)
            if score is not None and score < blur_thresh:
                rep.blurry.append({"path": img, "score": round(score, 2)})
            h = average_hash(gray)
            if h is not None:
                hashes[img] = h

        # labels
        if lbl is None:
            rep.n_unlabeled += 1
            continue
        _img_root, _lbl_root = _roots(data_dir)
        labeled_images.add(os.path.splitext(os.path.relpath(img, _img_root))[0])
        rep.n_labeled += 1
        rows, errs = _parse_label(lbl)
        if errs:
            rep.label_errors.append({"path": lbl, "errors": errs})
        for cid, *_ in rows:
            if n_classes and (cid < 0 or cid >= n_classes):
                rep.bad_class_ids.append({"path": lbl, "class_id": cid})
            name = classes[cid] if (n_classes and 0 <= cid < n_classes) else f"class_{cid}"
            box_counts[name] += 1

    # orphan labels (a .txt with no matching image)
    _img_root, lbl_root = _roots(data_dir)
    if os.path.isdir(lbl_root) and lbl_root != _img_root:
        for root, _dirs, files in os.walk(lbl_root):
            for fn in files:
                if fn.endswith(".txt"):
                    rel = os.path.splitext(os.path.relpath(os.path.join(root, fn), lbl_root))[0]
                    if rel not in labeled_images:
                        rep.n_orphan_labels += 1

    rep.class_box_counts = dict(box_counts)
    if box_counts:
        mx, mn = max(box_counts.values()), min(box_counts.values())
        rep.imbalance_ratio = round(mx / mn, 2) if mn else float("inf")

    # near-duplicate grouping (union-find lite by scanning)
    rep.duplicates = _group_duplicates(hashes, phash_dist)

    rep.recommendations = _recommend(rep)
    return rep


def _group_duplicates(hashes: dict[str, int], max_dist: int) -> list[list[str]]:
    items = list(hashes.items())
    parent = {p: p for p, _ in items}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        parent[find(a)] = find(b)

    for i in range(len(items)):
        pi, hi = items[i]
        for j in range(i + 1, len(items)):
            pj, hj = items[j]
            if hamming(hi, hj) <= max_dist:
                union(pi, pj)
    groups: dict[str, list[str]] = defaultdict(list)
    for p, _ in items:
        groups[find(p)].append(p)
    return [sorted(g) for g in groups.values() if len(g) > 1]


def _recommend(rep: QualityReport) -> list[str]:
    recs: list[str] = []
    if not rep.decoding_available:
        recs.append(
            "Install Pillow or opencv-python to enable blur/duplicate detection "
            "(label + pairing audits ran without them)."
        )
    if rep.n_unlabeled:
        recs.append(f"{rep.n_unlabeled} images have NO label -- annotate or drop them.")
    if rep.n_orphan_labels:
        recs.append(f"{rep.n_orphan_labels} label files have no matching image -- remove them.")
    if rep.n_corrupt:
        recs.append(f"{rep.n_corrupt} images failed to decode -- likely corrupt.")
    dup_imgs = sum(len(g) - 1 for g in rep.duplicates)
    if dup_imgs:
        recs.append(f"{dup_imgs} near-duplicate images across {len(rep.duplicates)} groups "
                    "-- dedupe to avoid train/val leakage.")
    if rep.blurry:
        recs.append(f"{len(rep.blurry)} blurry/low-quality images below threshold -- review or drop.")
    if rep.label_errors:
        recs.append(f"{len(rep.label_errors)} label files have coordinate/format errors -- fix before training.")
    if rep.bad_class_ids:
        recs.append(f"{len(rep.bad_class_ids)} boxes reference class ids outside data.yaml -- taxonomy drift.")
    if rep.class_box_counts:
        counts = rep.class_box_counts
        if rep.imbalance_ratio and rep.imbalance_ratio != float("inf") and rep.imbalance_ratio >= 5:
            weakest = sorted(counts.items(), key=lambda kv: kv[1])[:3]
            names = ", ".join(f"{k}({v})" for k, v in weakest)
            recs.append(f"Class imbalance {rep.imbalance_ratio}:1 -- collect more data for: {names}.")
        missing = [c for c in rep.class_names if c not in counts]
        if missing:
            recs.append(f"Classes with ZERO examples: {', '.join(missing)} -- source data or drop from taxonomy.")
    if not recs:
        recs.append("No quality issues detected -- dataset looks clean.")
    return recs


# ------------------------------------------------------------------- cleanup
def apply_cleanup(
    data_dir: str,
    out_dir: str,
    rep: QualityReport,
    drop_dupes: bool = True,
    drop_blurry: bool = False,
    drop_unlabeled: bool = True,
) -> dict:
    """Write a NEW cleaned dataset (input is never mutated)."""
    import shutil

    drop = set()
    if drop_dupes:
        for group in rep.duplicates:
            drop.update(group[1:])  # keep first, drop the rest
    if drop_blurry:
        drop.update(b["path"] for b in rep.blurry)

    kept = 0
    for img, lbl in _iter_pairs(data_dir):
        if img in drop:
            continue
        if drop_unlabeled and lbl is None:
            continue
        rel = os.path.relpath(img, os.path.join(data_dir, "images")
                              if os.path.isdir(os.path.join(data_dir, "images")) else data_dir)
        dst_img = os.path.join(out_dir, "images", rel)
        os.makedirs(os.path.dirname(dst_img), exist_ok=True)
        shutil.copy2(img, dst_img)
        if lbl is not None:
            dst_lbl = os.path.join(out_dir, "labels", os.path.splitext(rel)[0] + ".txt")
            os.makedirs(os.path.dirname(dst_lbl), exist_ok=True)
            shutil.copy2(lbl, dst_lbl)
        kept += 1

    # carry data.yaml forward with a corrected path
    src_yaml = os.path.join(data_dir, "data.yaml")
    if os.path.exists(src_yaml):
        with open(src_yaml) as f:
            txt = f.read()
        lines = []
        for line in txt.splitlines():
            if line.strip().startswith("path:"):
                lines.append(f"path: {os.path.abspath(out_dir)}")
            else:
                lines.append(line)
        with open(os.path.join(out_dir, "data.yaml"), "w") as f:
            f.write("\n".join(lines) + "\n")

    return {"kept": kept, "dropped": len(drop), "out": out_dir}


# ------------------------------------------------------------------------- CLI
def main() -> None:
    ap = argparse.ArgumentParser(description="AI Data Quality Manager")
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("audit")
    a.add_argument("--data", required=True)
    a.add_argument("--blur-thresh", type=float, default=60.0)
    a.add_argument("--phash-dist", type=int, default=6)
    a.add_argument("--json", default=None, help="write full report JSON here")

    c = sub.add_parser("clean")
    c.add_argument("--data", required=True)
    c.add_argument("--out", required=True)
    c.add_argument("--blur-thresh", type=float, default=60.0)
    c.add_argument("--phash-dist", type=int, default=6)
    c.add_argument("--drop-dupes", action="store_true")
    c.add_argument("--drop-blurry", action="store_true")
    c.add_argument("--keep-unlabeled", action="store_true")

    args = ap.parse_args()
    rep = audit(args.data, args.blur_thresh, args.phash_dist)

    summary = {
        "images": rep.n_images, "labeled": rep.n_labeled, "unlabeled": rep.n_unlabeled,
        "orphan_labels": rep.n_orphan_labels, "corrupt": rep.n_corrupt,
        "duplicate_groups": len(rep.duplicates), "blurry": len(rep.blurry),
        "label_error_files": len(rep.label_errors), "bad_class_ids": len(rep.bad_class_ids),
        "class_box_counts": rep.class_box_counts, "imbalance_ratio": rep.imbalance_ratio,
        "decoding_available": rep.decoding_available,
        "recommendations": rep.recommendations,
    }
    print(json.dumps(summary, indent=2))

    if args.cmd == "audit" and args.json:
        with open(args.json, "w") as f:
            json.dump(rep.to_dict(), f, indent=2)
        print(f"\nfull report -> {args.json}")

    if args.cmd == "clean":
        res = apply_cleanup(
            args.data, args.out, rep,
            drop_dupes=args.drop_dupes, drop_blurry=args.drop_blurry,
            drop_unlabeled=not args.keep_unlabeled,
        )
        print("\ncleanup:", json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
