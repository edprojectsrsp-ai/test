r"""
Honest evaluation -- the golden set, and scoring any model on it.

The problem this replaces
------------------------
The training service measured a challenger on a validation split carved out of
the same growing pool it trains on (`images[:n_val]` of a sorted list that grows
every run), so yesterday's validation frames became today's training frames.
Then `promote_only_if_better` compared that number against the incumbent's
number — which had been measured on a *different* split, in a *different* run,
by a *different* code path. Two numbers from two datasets, compared as if they
meant the same thing. It could not detect a regression, and worse, it reported
that it had checked.

What replaces it
----------------
A golden set: frames a human labelled and then deliberately withheld. They are
excluded from `export_yolo` and therefore from every dataset version forever, so
no model has ever fitted them. Every model is scored on that identical, frozen
set, and the comparison between two models is finally between two numbers that
mean the same thing.

Two properties worth stating because they are what make the number trustworthy:

* **The set is fingerprinted.** `golden_sha` is derived from the exact image
  stems and their label contents. Add a frame and the fingerprint changes, so a
  run measured against 40 frames can never be silently compared with one
  measured against 200 — the comparison refuses instead of quietly lying.

* **Per class, with support.** A model can lift aggregate mAP while collapsing
  on `no_harness`, and on a fall-risk site that single class is the whole point.
  Aggregates hide it; per-class numbers with instance counts do not. A class
  with two instances is reported as such rather than being allowed to swing a
  promotion decision.
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings
from app.ml import taxonomy

log = logging.getLogger(__name__)

# A class needs at least this many ground-truth instances before its score is
# allowed to block a promotion. Below it the metric is dominated by which single
# frame happened to be labelled, and gating on noise means the gate gets turned
# off by whoever is on call.
MIN_SUPPORT_TO_GATE = 5

# How far a class may fall before promotion is refused, even when the aggregate
# improved. Chosen to sit above run-to-run jitter and below anything an operator
# would call "still working".
CLASS_REGRESSION_TOLERANCE = 0.10


def golden_dir() -> Path:
    return get_settings().DATASETS_DIR / "_golden"


@dataclass
class GoldenSet:
    """A materialised, frozen evaluation set on disk."""
    path: Path
    data_yaml: Path
    images: int
    instances: int
    sha: str
    version: str
    class_support: dict

    def as_dict(self) -> dict:
        return {
            "path": str(self.path), "images": self.images,
            "instances": self.instances, "sha": self.sha,
            "version": self.version, "class_support": self.class_support,
        }


def _sha_of(parts: list[str]) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:16]


def weights_fingerprint(path: str | Path) -> str:
    """Content hash of a checkpoint, so re-scoring the same file is detectable.

    Hashes size + head + tail rather than the whole file: checkpoints run to
    hundreds of megabytes, a full hash costs seconds on every call, and this is
    used to spot "same file" not to defend against a forger.
    """
    p = Path(path)
    if not p.exists():
        return ""
    try:
        size = p.stat().st_size
        h = hashlib.sha256(str(size).encode())
        with open(p, "rb") as f:
            h.update(f.read(1 << 20))
            if size > (2 << 20):
                f.seek(-(1 << 20), 2)
                h.update(f.read(1 << 20))
        return h.hexdigest()[:16]
    except Exception:  # noqa: BLE001
        return ""


# --------------------------------------------------------------- golden build
async def build_golden_set(session, rebuild: bool = False) -> GoldenSet:
    """Materialise every golden capture into a frozen YOLO eval dataset.

    Rebuilt from the database rather than accumulated on disk, so un-marking a
    frame actually removes it from the set. A stale image left behind would keep
    scoring against a label the operator has retracted.
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models.review import CaptureItem

    rows = list((await session.execute(
        select(CaptureItem)
        .where(CaptureItem.is_golden.is_(True))
        .options(selectinload(CaptureItem.labels))
        .order_by(CaptureItem.created_at.asc())
    )).scalars())

    root = golden_dir()
    img_dir, lbl_dir = root / "images", root / "labels"
    if rebuild and root.exists():
        shutil.rmtree(root, ignore_errors=True)
    img_dir.mkdir(parents=True, exist_ok=True)
    lbl_dir.mkdir(parents=True, exist_ok=True)

    keep: set[str] = set()
    fingerprint_parts: list[str] = []
    support: dict[str, int] = {}
    instances = 0

    for item in rows:
        src = Path(item.image_path)
        if not src.exists():
            log.warning("golden capture %s image missing: %s", item.id, src)
            continue
        stem = src.stem
        keep.add(stem)
        dst = img_dir / f"{stem}.jpg"
        if not dst.exists():
            shutil.copy2(src, dst)
        lines = []
        for lab in sorted(item.labels, key=lambda x: (x.cls_name, x.cx, x.cy)):
            cid = taxonomy.CLASS_TO_ID.get(lab.cls_name)
            if cid is None:
                continue
            lines.append(f"{cid} {lab.cx:.6f} {lab.cy:.6f} {lab.w:.6f} {lab.h:.6f}")
            support[lab.cls_name] = support.get(lab.cls_name, 0) + 1
            instances += 1
        body = "\n".join(lines)
        (lbl_dir / f"{stem}.txt").write_text(body)
        fingerprint_parts.append(f"{stem}|{body}")

    # Drop anything no longer golden.
    for stale in list(img_dir.glob("*.jpg")):
        if stale.stem not in keep:
            stale.unlink(missing_ok=True)
            (lbl_dir / f"{stale.stem}.txt").unlink(missing_ok=True)

    names_block = "\n".join(
        f"  {i}: {n}" for i, n in enumerate(taxonomy.CANONICAL_CLASSES))
    listing = root / "val.txt"
    listing.write_text("\n".join(
        str(img_dir / f"{s}.jpg") for s in sorted(keep)))
    data_yaml = root / "data.yaml"
    # train and val both point at the golden listing: ultralytics requires a
    # train key, and nothing here ever trains — `val()` reads only `val`.
    data_yaml.write_text(
        f"path: {root}\ntrain: {listing}\nval: {listing}\n"
        f"nc: {len(taxonomy.CANONICAL_CLASSES)}\nnames:\n{names_block}\n")

    sha = _sha_of(sorted(fingerprint_parts))
    version = f"g{len(keep)}-{sha[:8]}"
    meta = {
        "images": len(keep), "instances": instances, "sha": sha,
        "version": version, "class_support": support, "built_at": time.time(),
    }
    (root / "golden.json").write_text(json.dumps(meta, indent=2))

    return GoldenSet(path=root, data_yaml=data_yaml, images=len(keep),
                     instances=instances, sha=sha, version=version,
                     class_support=support)


def load_golden_meta() -> dict:
    p = golden_dir() / "golden.json"
    if not p.exists():
        return {"images": 0, "instances": 0, "sha": "", "version": "",
                "class_support": {}}
    try:
        return json.loads(p.read_text())
    except Exception:  # noqa: BLE001
        return {"images": 0, "instances": 0, "sha": "", "version": "",
                "class_support": {}}


# -------------------------------------------------------------------- scoring
def score_model(weights: str | Path, data_yaml: Path, imgsz: int = 640,
                conf: float = 0.25) -> dict:
    """Run one model over the golden set. Blocking — call from a thread.

    Returns aggregates, per-class rows and the confusion matrix. Never raises
    for a class the model cannot predict: a model trained before `harness`
    existed simply scores 0 on it, which is the correct and useful answer.
    """
    from ultralytics import YOLO

    t0 = time.time()
    model = YOLO(str(weights))
    res = model.val(data=str(data_yaml), imgsz=imgsz, conf=conf,
                    verbose=False, plots=False)
    box = getattr(res, "box", None)

    out = {
        "map50": round(float(getattr(box, "map50", 0.0) or 0.0), 4),
        "map50_95": round(float(getattr(box, "map", 0.0) or 0.0), 4),
        "precision": round(float(getattr(box, "mp", 0.0) or 0.0), 4),
        "recall": round(float(getattr(box, "mr", 0.0) or 0.0), 4),
        "duration_s": round(time.time() - t0, 2),
        "per_class": [],
        "confusion": {},
    }

    # Per class. ultralytics reports only the classes present in the data, and
    # `ap_class_index` maps its row order back to our canonical class ids.
    try:
        idx = list(getattr(box, "ap_class_index", []) or [])
        names = getattr(res, "names", None) or {}
        p_all = list(getattr(box, "p", []) or [])
        r_all = list(getattr(box, "r", []) or [])
        ap50 = list(getattr(box, "ap50", []) or [])
        ap = list(getattr(box, "ap", []) or [])
        for i, cid in enumerate(idx):
            cid = int(cid)
            name = names.get(cid) if isinstance(names, dict) else None
            if not name and cid < len(taxonomy.CANONICAL_CLASSES):
                name = taxonomy.CANONICAL_CLASSES[cid]
            row_ap = ap[i] if i < len(ap) else 0.0
            out["per_class"].append({
                "cls_name": name or f"class_{cid}",
                "precision": round(float(p_all[i]) if i < len(p_all) else 0.0, 4),
                "recall": round(float(r_all[i]) if i < len(r_all) else 0.0, 4),
                "map50": round(float(ap50[i]) if i < len(ap50) else 0.0, 4),
                "map50_95": round(
                    float(row_ap.mean() if hasattr(row_ap, "mean") else row_ap), 4),
            })
    except Exception as exc:  # noqa: BLE001 - aggregates still stand
        log.warning("per-class metrics unavailable: %s", exc)

    try:
        cm = getattr(res, "confusion_matrix", None)
        matrix = getattr(cm, "matrix", None)
        if matrix is not None:
            labels = list(taxonomy.CANONICAL_CLASSES) + ["background"]
            out["confusion"] = {
                "labels": labels,
                "rows": [[int(v) for v in row] for row in matrix.tolist()],
            }
    except Exception as exc:  # noqa: BLE001
        log.warning("confusion matrix unavailable: %s", exc)

    return out


# ----------------------------------------------------------------- comparison
def compare(challenger: dict, incumbent: dict | None, support: dict,
            tolerance: float = CLASS_REGRESSION_TOLERANCE) -> dict:
    """Decide whether the challenger may go live, and say exactly why.

    Two gates, both of which have to pass:

      aggregate   mAP50 must not fall
      per class   no class with real support may fall by more than `tolerance`

    The second gate is the one that matters in practice. A challenger trained on
    a week of helmet corrections will lift aggregate mAP while quietly losing
    harness recall, because harness is rare and contributes almost nothing to
    the average. On a site where harness is the fall-arrest check, that trade is
    exactly backwards — and the aggregate would have approved it.
    """
    verdict = {"promote": True, "reasons": [], "blocking": [],
               "aggregate": {}, "regressions": [], "improvements": []}

    new50 = float(challenger.get("map50") or 0.0)
    if incumbent is None:
        verdict["reasons"].append(
            "no incumbent scored on this golden set — promoting as the baseline")
        verdict["aggregate"] = {"challenger_map50": new50, "incumbent_map50": None}
        return verdict

    old50 = float(incumbent.get("map50") or 0.0)
    verdict["aggregate"] = {
        "challenger_map50": new50, "incumbent_map50": old50,
        "delta": round(new50 - old50, 4),
    }
    if new50 + 1e-6 < old50:
        verdict["promote"] = False
        verdict["blocking"].append(
            f"aggregate mAP50 fell {old50:.3f} -> {new50:.3f}")
    else:
        verdict["reasons"].append(
            f"aggregate mAP50 {old50:.3f} -> {new50:.3f}")

    old_by = {c["cls_name"]: c for c in (incumbent.get("per_class") or [])}
    new_by = {c["cls_name"]: c for c in (challenger.get("per_class") or [])}
    for name, old_row in old_by.items():
        n = int(support.get(name, 0))
        new_row = new_by.get(name)
        old_r = float(old_row.get("map50") or 0.0)
        new_r = float((new_row or {}).get("map50") or 0.0)
        delta = round(new_r - old_r, 4)
        entry = {"cls_name": name, "support": n, "incumbent_map50": old_r,
                 "challenger_map50": new_r, "delta": delta}
        if delta <= -tolerance:
            if n >= MIN_SUPPORT_TO_GATE:
                verdict["promote"] = False
                verdict["blocking"].append(
                    f"{name} mAP50 fell {old_r:.3f} -> {new_r:.3f} "
                    f"({n} golden instances)")
                entry["blocking"] = True
            else:
                # Too few instances to be evidence. Reported so it is visible,
                # not used to block, because gating on two frames means the gate
                # fires at random and gets switched off.
                entry["blocking"] = False
                entry["note"] = (f"only {n} golden instance(s) — too few to "
                                 f"block a promotion; add more to gate on it")
            verdict["regressions"].append(entry)
        elif delta >= tolerance:
            verdict["improvements"].append(entry)

    if verdict["promote"] and not verdict["blocking"]:
        verdict["reasons"].append(
            f"no class with >={MIN_SUPPORT_TO_GATE} golden instances regressed "
            f"by more than {tolerance:.0%}")
    return verdict


# ------------------------------------------------------------------ persisting
async def record_run(session, *, weights: str, label: str, golden: dict,
                     scores: dict, model_version: int | None = None,
                     imgsz: int = 640, conf: float = 0.25,
                     trigger: str = "manual", error: str = "") -> str:
    """Persist one evaluation and its per-class rows. Returns the run id."""
    from app.models.modelops import EvalClassMetric, EvalRun, EvalStatus

    run = EvalRun(
        weights_path=str(weights),
        weights_sha=weights_fingerprint(weights),
        model_version=model_version,
        model_label=label or Path(str(weights)).name,
        golden_version=golden.get("version", ""),
        golden_images=int(golden.get("images") or 0),
        golden_sha=golden.get("sha", ""),
        status=EvalStatus.failed if error else EvalStatus.done,
        map50=float(scores.get("map50") or 0.0),
        map50_95=float(scores.get("map50_95") or 0.0),
        precision=float(scores.get("precision") or 0.0),
        recall=float(scores.get("recall") or 0.0),
        confusion=scores.get("confusion") or {},
        imgsz=imgsz, conf=conf,
        duration_s=float(scores.get("duration_s") or 0.0),
        trigger=trigger, error=error,
    )
    session.add(run)
    await session.flush()
    support = golden.get("class_support") or {}
    for row in (scores.get("per_class") or []):
        session.add(EvalClassMetric(
            run_id=run.id, cls_name=row["cls_name"],
            support=int(support.get(row["cls_name"], 0)),
            precision=row["precision"], recall=row["recall"],
            map50=row["map50"], map50_95=row["map50_95"]))
    await session.commit()
    return run.id


async def latest_run_for(session, weights_sha: str, golden_sha: str):
    """The most recent successful run of this exact model on this exact set.

    Both fingerprints must match. Comparing a score measured on 40 golden frames
    against one measured on 200 is the precise mistake this whole module exists
    to stop, so a mismatch returns nothing and the caller re-scores.
    """
    from sqlalchemy import select

    from app.models.modelops import EvalRun, EvalStatus

    if not weights_sha or not golden_sha:
        return None
    return (await session.execute(
        select(EvalRun)
        .where(EvalRun.weights_sha == weights_sha)
        .where(EvalRun.golden_sha == golden_sha)
        .where(EvalRun.status == EvalStatus.done)
        .order_by(EvalRun.created_at.desc())
        .limit(1)
    )).scalars().first()


async def run_to_scores(session, run) -> dict:
    """Rehydrate a stored run into the dict shape `compare` expects."""
    from sqlalchemy import select

    from app.models.modelops import EvalClassMetric

    rows = list((await session.execute(
        select(EvalClassMetric).where(EvalClassMetric.run_id == run.id)
    )).scalars())
    return {
        "map50": run.map50, "map50_95": run.map50_95,
        "precision": run.precision, "recall": run.recall,
        "confusion": run.confusion or {},
        "per_class": [{
            "cls_name": r.cls_name, "precision": r.precision, "recall": r.recall,
            "map50": r.map50, "map50_95": r.map50_95, "support": r.support,
        } for r in rows],
    }
