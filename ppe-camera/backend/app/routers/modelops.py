r"""
Model Operations API -- can you prove the model got better?

Four groups:

  golden     curate the held-out evaluation set; see what it covers and, more
             importantly, what it does not
  evaluate   score any model on it, per class, and compare two models on
             identical frames
  shadow     run a candidate against live traffic and collect the frames where
             it and the live model cannot both be right
  drift      per-camera baselines, and what has moved away from them

The single idea underneath all four: a number is only worth acting on if you
know exactly which frames produced it. Every endpoint here reports the golden
fingerprint alongside the score, and comparisons refuse to run across different
fingerprints rather than quietly returning a meaningless delta.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.modelops import (DriftSample, EvalClassMetric, EvalRun,
                                 EvalStatus, ShadowVerdict)
from app.models.review import CaptureItem, CaptureStatus
from app.services import evaluation, shadow

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/modelops", tags=["modelops"])


# ==================================================================== golden
@router.get("/golden")
async def golden_status() -> dict:
    """What the golden set contains, and where it is too thin to trust.

    The coverage warnings are the point. A golden set with four `no_harness`
    instances cannot detect a harness regression, and a gate that silently does
    not gate is worse than no gate — so the thin classes are named explicitly
    rather than left to be inferred from a table of numbers.
    """
    async with SessionLocal() as session:
        golden = await evaluation.build_golden_set(session)
        labeled = int(await session.scalar(
            select(func.count()).select_from(CaptureItem)
            .where(CaptureItem.is_golden.is_(False))
            .where(CaptureItem.status.in_(
                [CaptureStatus.labeled, CaptureStatus.exported]))) or 0)

    support = golden.class_support
    thin = sorted(
        [{"cls_name": c, "support": n} for c, n in support.items()
         if n < evaluation.MIN_SUPPORT_TO_GATE],
        key=lambda x: x["support"])
    from app.ml import taxonomy
    absent = [c for c in taxonomy.CANONICAL_CLASSES if c not in support]

    return {
        **golden.as_dict(),
        "trainable_frames": labeled,
        "min_support_to_gate": evaluation.MIN_SUPPORT_TO_GATE,
        "regression_tolerance": evaluation.CLASS_REGRESSION_TOLERANCE,
        "ready": golden.images >= 5,
        "thin_classes": thin,
        "absent_classes": absent,
        "hint": (
            "Mark reviewed frames as golden to build a held-out set. Under 5 "
            "frames there is no gate at all; 30+ covering every gear class you "
            "enforce is where the numbers start meaning something."
            if golden.images < 30 else
            f"{golden.images} held-out frames covering {len(support)} classes. "
            f"Classes with fewer than {evaluation.MIN_SUPPORT_TO_GATE} instances "
            f"are reported but cannot block a promotion."),
    }


class GoldenMarkIn(BaseModel):
    capture_ids: list[str] = Field(..., min_length=1)
    golden: bool = True
    note: str = ""


@router.post("/golden/mark")
async def mark_golden(body: GoldenMarkIn) -> dict:
    """Move labelled frames into (or out of) the held-out set.

    Only labelled frames qualify: an unlabelled frame has no ground truth, so it
    could not score anything. A frame already baked into a dataset version can
    still be marked — it is excluded from every FUTURE export, and the honest
    caveat is surfaced rather than hidden, because a model trained before the
    mark has already seen it.
    """
    from datetime import datetime, timezone

    marked, skipped, tainted = [], [], []
    async with SessionLocal() as session:
        for cid in body.capture_ids:
            item = await session.get(CaptureItem, cid)
            if item is None:
                skipped.append({"id": cid, "why": "not found"})
                continue
            if body.golden and item.status not in (CaptureStatus.labeled,
                                                   CaptureStatus.exported):
                skipped.append({"id": cid, "why": f"status is {item.status.value}"
                                                  " — label it first"})
                continue
            if body.golden and item.status == CaptureStatus.exported:
                tainted.append(cid)
            item.is_golden = bool(body.golden)
            item.golden_at = datetime.now(timezone.utc) if body.golden else None
            item.golden_note = body.note if body.golden else ""
            marked.append(cid)
        await session.commit()
        golden = await evaluation.build_golden_set(session, rebuild=True)

    out = {"marked": marked, "skipped": skipped, "golden": golden.as_dict()}
    if tainted:
        out["warning"] = (
            f"{len(tainted)} frame(s) were already exported into a training "
            f"dataset, so models trained before now have seen them and will "
            f"score optimistically on them. They are excluded from all future "
            f"exports. For a clean baseline, retrain once after marking.")
    return out


@router.post("/golden/rebuild")
async def rebuild_golden() -> dict:
    """Re-materialise the golden set from the database."""
    async with SessionLocal() as session:
        return (await evaluation.build_golden_set(session, rebuild=True)).as_dict()


@router.get("/golden/candidates")
async def golden_candidates(limit: int = Query(40, ge=1, le=200)) -> dict:
    """Labelled frames worth holding out, rarest classes first.

    Ordered by how badly the golden set needs each frame's classes rather than
    by date: a hundred more helmet frames add nothing once helmet is covered,
    while one harness frame may be the difference between a gate that works and
    one that cannot see the class at all.
    """
    from sqlalchemy.orm import selectinload

    async with SessionLocal() as session:
        golden = await evaluation.build_golden_set(session)
        rows = list((await session.execute(
            select(CaptureItem)
            .where(CaptureItem.is_golden.is_(False))
            .where(CaptureItem.status.in_(
                [CaptureStatus.labeled, CaptureStatus.exported]))
            .options(selectinload(CaptureItem.labels))
            .order_by(CaptureItem.created_at.desc())
            .limit(400))).scalars())

    support = golden.class_support
    scored = []
    for item in rows:
        classes = sorted({l.cls_name for l in item.labels})
        if not classes:
            continue
        # Value = how under-represented this frame's rarest class is.
        need = max((max(0, evaluation.MIN_SUPPORT_TO_GATE * 3 - support.get(c, 0))
                    for c in classes), default=0)
        scored.append({
            "capture_id": item.id, "camera_id": item.camera_id,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "classes": classes, "label_count": len(item.labels),
            "already_exported": item.status == CaptureStatus.exported,
            "value": need,
            "why": ("adds " + ", ".join(
                c for c in classes
                if support.get(c, 0) < evaluation.MIN_SUPPORT_TO_GATE * 3)
                or "classes already well covered"),
        })
    scored.sort(key=lambda x: (-x["value"], x["capture_id"]))
    return {"candidates": scored[:limit], "golden_support": support}


# ================================================================== evaluate
def _resolve_weights(model: str) -> tuple[str, str, int | None]:
    """Turn a model reference into (path, label, registry_version).

    Accepts a registry version number, "live", a zoo key, or a path — the same
    references the rest of the API takes, so evaluating a model never requires
    knowing where it happens to live on disk.
    """
    s = get_settings()
    if model in ("", "live", "active"):
        for p in sorted(s.WEIGHTS_DIR.glob("ppe_active.*"),
                        key=lambda x: x.stat().st_mtime, reverse=True):
            if p.suffix.lower() == ".pt":
                return str(p), "live model", None
        raise HTTPException(404, "no live .pt checkpoint on disk")
    if model.isdigit():
        from app.routers.models import _load, _resolve_weights

        entry = next((v for v in _load()["versions"]
                      if v["version"] == int(model)), None)
        if entry is None:
            raise HTTPException(404, f"unknown model version {model}")
        # Registry paths are absolute and machine-specific; resolve against
        # this install's weights dir so evaluation works off the build box.
        return str(_resolve_weights(entry)), f"v{model}", int(model)
    zoo = s.WEIGHTS_DIR / "zoo" / f"{model}.pt"
    if zoo.exists():
        return str(zoo), model, None
    if os.path.exists(model):
        return model, Path(model).name, None
    raise HTTPException(404, f"could not resolve model '{model}'")


class EvaluateIn(BaseModel):
    model: str = "live"
    imgsz: int = Field(640, ge=160, le=1536)
    conf: float = Field(0.25, ge=0.01, le=0.9)
    force: bool = False       # re-score even if an identical run exists


@router.post("/evaluate")
async def evaluate(body: EvaluateIn) -> dict:
    """Score one model on the golden set. Blocking but thread-offloaded."""
    import anyio

    weights, label, version = _resolve_weights(body.model)
    if not Path(weights).exists():
        raise HTTPException(410, f"weights file missing: {weights}")

    async with SessionLocal() as session:
        golden = await evaluation.build_golden_set(session)
        if golden.images < 1:
            raise HTTPException(
                409, "the golden set is empty — mark some labelled frames as "
                     "golden before evaluating")
        sha = evaluation.weights_fingerprint(weights)
        if not body.force:
            prior = await evaluation.latest_run_for(session, sha, golden.sha)
            if prior is not None:
                scores = await evaluation.run_to_scores(session, prior)
                return {"run_id": prior.id, "cached": True, "label": prior.model_label,
                        "golden": golden.as_dict(), **scores}

    try:
        scores = await anyio.to_thread.run_sync(
            lambda: evaluation.score_model(weights, golden.data_yaml,
                                           body.imgsz, body.conf))
    except Exception as exc:  # noqa: BLE001
        async with SessionLocal() as session:
            await evaluation.record_run(
                session, weights=weights, label=label, golden=golden.as_dict(),
                scores={}, model_version=version, imgsz=body.imgsz,
                conf=body.conf, error=f"{type(exc).__name__}: {exc}")
        raise HTTPException(500, f"evaluation failed: {exc}")

    async with SessionLocal() as session:
        run_id = await evaluation.record_run(
            session, weights=weights, label=label, golden=golden.as_dict(),
            scores=scores, model_version=version, imgsz=body.imgsz, conf=body.conf)
    return {"run_id": run_id, "cached": False, "label": label,
            "golden": golden.as_dict(), **scores}


@router.get("/runs")
async def list_runs(limit: int = Query(50, ge=1, le=500)) -> dict:
    async with SessionLocal() as session:
        rows = list((await session.execute(
            select(EvalRun).order_by(EvalRun.created_at.desc()).limit(limit)
        )).scalars())
    return {"runs": [{
        "id": r.id, "label": r.model_label, "model_version": r.model_version,
        "weights_sha": r.weights_sha, "golden_version": r.golden_version,
        "golden_images": r.golden_images, "golden_sha": r.golden_sha,
        "status": r.status.value, "map50": r.map50, "map50_95": r.map50_95,
        "precision": r.precision, "recall": r.recall,
        "duration_s": r.duration_s, "trigger": r.trigger, "error": r.error,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows]}


@router.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict:
    async with SessionLocal() as session:
        run = await session.get(EvalRun, run_id)
        if run is None:
            raise HTTPException(404, f"run {run_id} not found")
        scores = await evaluation.run_to_scores(session, run)
    return {
        "id": run.id, "label": run.model_label, "status": run.status.value,
        "golden_version": run.golden_version, "golden_images": run.golden_images,
        "golden_sha": run.golden_sha, "trigger": run.trigger,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        **scores,
    }


@router.get("/compare")
async def compare_runs(a: str, b: str) -> dict:
    """Compare two evaluation runs — the challenger/incumbent view.

    Refuses across different golden fingerprints. A delta between a score on 40
    frames and one on 200 is not a smaller or larger number, it is a different
    question, and presenting it as a comparison is exactly the failure this
    module was built to remove.
    """
    async with SessionLocal() as session:
        run_a = await session.get(EvalRun, a)
        run_b = await session.get(EvalRun, b)
        if run_a is None or run_b is None:
            raise HTTPException(404, "one or both runs not found")
        if run_a.golden_sha != run_b.golden_sha:
            raise HTTPException(
                409, f"these runs were scored on different golden sets "
                     f"({run_a.golden_version} vs {run_b.golden_version}) — "
                     f"re-evaluate both on the current set to compare them")
        scores_a = await evaluation.run_to_scores(session, run_a)
        scores_b = await evaluation.run_to_scores(session, run_b)
        support = {c["cls_name"]: c["support"] for c in scores_b["per_class"]}
        support.update({c["cls_name"]: c["support"] for c in scores_a["per_class"]})

    verdict = evaluation.compare(scores_b, scores_a, support)
    return {
        "incumbent": {"run_id": a, "label": run_a.model_label, **scores_a},
        "challenger": {"run_id": b, "label": run_b.model_label, **scores_b},
        "golden_version": run_a.golden_version,
        "verdict": verdict,
    }


# ==================================================================== shadow
class ShadowStartIn(BaseModel):
    model: str
    sample_rate: float = Field(0.15, ge=0.01, le=1.0)
    cameras: list[str] = Field(default_factory=list)


@router.post("/shadow/start")
async def shadow_start(body: ShadowStartIn) -> dict:
    """Run a candidate model against live traffic alongside the live model.

    sample_rate is capped low by default: two models on every frame halves fleet
    capacity, and a shadow evaluation that degrades the detection it is
    measuring is a bad trade at any accuracy.
    """
    weights, label, _version = _resolve_weights(body.model)
    if not Path(weights).exists():
        raise HTTPException(410, f"weights file missing: {weights}")
    return shadow.start_shadow(weights, label=label,
                               sample_rate=body.sample_rate,
                               cameras=body.cameras)


@router.post("/shadow/stop")
async def shadow_stop() -> dict:
    return shadow.stop_shadow()


@router.get("/shadow/status")
async def shadow_state() -> dict:
    st = shadow.shadow_status()
    async with SessionLocal() as session:
        st["stored_verdicts"] = int(await session.scalar(
            select(func.count()).select_from(ShadowVerdict)) or 0)
        rows = (await session.execute(
            select(ShadowVerdict.kind, func.count())
            .group_by(ShadowVerdict.kind))).all()
        st["by_kind"] = {k: n for k, n in rows}
    return st


@router.get("/shadow/verdicts")
async def shadow_verdicts(kind: str = "", camera_id: str = "",
                          adjudicated: str = "",
                          limit: int = Query(60, ge=1, le=300)) -> dict:
    q = select(ShadowVerdict)
    if kind:
        q = q.where(ShadowVerdict.kind == kind)
    if camera_id:
        q = q.where(ShadowVerdict.camera_id == camera_id)
    if adjudicated == "pending":
        q = q.where(ShadowVerdict.adjudicated == "")
    elif adjudicated:
        q = q.where(ShadowVerdict.adjudicated == adjudicated)
    async with SessionLocal() as session:
        rows = list((await session.execute(
            q.order_by(ShadowVerdict.severity.desc(),
                       ShadowVerdict.created_at.desc()).limit(limit))).scalars())
    return {"verdicts": [{
        "id": v.id, "camera_id": v.camera_id, "kind": v.kind,
        "cls_name": v.cls_name, "severity": v.severity,
        "candidate_label": v.candidate_label,
        "live_boxes": v.live_boxes, "candidate_boxes": v.candidate_boxes,
        "adjudicated": v.adjudicated, "capture_id": v.capture_id,
        "has_image": bool(v.image_path and os.path.exists(v.image_path)),
        "created_at": v.created_at.isoformat() if v.created_at else None,
    } for v in rows]}


@router.get("/shadow/verdicts/{verdict_id}/image.jpg")
async def shadow_image(verdict_id: str):
    from fastapi.responses import FileResponse

    async with SessionLocal() as session:
        v = await session.get(ShadowVerdict, verdict_id)
    if v is None:
        raise HTTPException(404, "verdict not found")
    if not v.image_path or not os.path.exists(v.image_path):
        raise HTTPException(410, "frame no longer on disk")
    return FileResponse(v.image_path, media_type="image/jpeg")


class AdjudicateIn(BaseModel):
    winner: str = Field(..., pattern=r"^(live|candidate|neither)$")
    teach: bool = True


@router.post("/shadow/verdicts/{verdict_id}/adjudicate")
async def adjudicate(verdict_id: str, body: AdjudicateIn) -> dict:
    """Record who was right — and bank the answer as training data.

    This is what turns shadow mode from a readout into a data source. Every
    disagreement is a frame where two models cannot both be correct, so a human
    verdict here is worth far more per click than labelling a random frame: it
    lands exactly on the decision boundary.
    """
    from app.ml.detector import FrameResult
    from app.services.capture_service import get_capture_service
    from app.services.review_service import get_review_service

    async with SessionLocal() as session:
        v = await session.get(ShadowVerdict, verdict_id)
        if v is None:
            raise HTTPException(404, "verdict not found")
        v.adjudicated = body.winner
        capture_id = v.capture_id

        boxes = (v.candidate_boxes if body.winner == "candidate"
                 else v.live_boxes if body.winner == "live" else [])
        if body.teach and body.winner != "neither" and boxes:
            if not v.image_path or not os.path.exists(v.image_path):
                await session.commit()
                raise HTTPException(410, "frame no longer on disk — cannot teach")
            import cv2

            from app.ml import taxonomy

            frame = cv2.imread(v.image_path)
            if frame is None:
                await session.commit()
                raise HTTPException(422, "could not decode the stored frame")
            h, w = frame.shape[:2]
            keep = [{"cls": b["cls"], "xyxy": b["xyxy"]} for b in boxes
                    if b.get("cls") in taxonomy.CLASS_TO_ID]
            if keep:
                item = await get_capture_service().capture_manual(
                    session, v.camera_id, frame, FrameResult(width=w, height=h),
                    note=f"shadow adjudication — {body.winner} model was right "
                         f"({v.kind}, {v.cls_name})")
                item = await get_review_service().apply_corrections(
                    session, item.id, keep)
                v.capture_id = item.id
                capture_id = item.id
        await session.commit()
    return {"verdict_id": verdict_id, "winner": body.winner,
            "capture_id": capture_id, "taught": bool(capture_id)}


# ===================================================================== drift
@router.get("/drift")
async def drift_status(hours: int = Query(48, ge=1, le=720)) -> dict:
    """Per-camera drift: what has moved away from that camera's own baseline."""
    from datetime import datetime, timedelta, timezone

    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).replace(tzinfo=None)
    async with SessionLocal() as session:
        rows = list((await session.execute(
            select(DriftSample).where(DriftSample.created_at >= since)
            .order_by(DriftSample.created_at.desc()).limit(1000))).scalars())

    by_cam: dict[str, list] = {}
    for r in rows:
        by_cam.setdefault(r.camera_id, []).append({
            "id": r.id, "frames": r.frames,
            "detections_per_frame": r.detections_per_frame,
            "persons_per_frame": r.persons_per_frame,
            "mean_confidence": r.mean_confidence,
            "mean_brightness": r.mean_brightness,
            "class_rates": r.class_rates,
            "is_baseline": r.is_baseline, "drift_score": r.drift_score,
            "drift_reason": r.drift_reason,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    cameras = [{
        "camera_id": cam,
        "samples": items,
        "latest_drift": items[0]["drift_score"] if items else 0.0,
        "latest_reason": items[0]["drift_reason"] if items else "",
        "alarming": bool(items and items[0]["drift_score"] >= 0.30
                         and not items[0]["is_baseline"]),
    } for cam, items in by_cam.items()]
    cameras.sort(key=lambda c: -c["latest_drift"])
    return {
        "hours": hours, "cameras": cameras,
        "alarming": sum(1 for c in cameras if c["alarming"]),
        "live": shadow.get_drift().snapshot(),
        "note": ("Drift compares each camera against its OWN baseline, not "
                 "against other cameras — a gate and a storage yard have "
                 "nothing in common and a fleet average hides both."),
    }


@router.post("/drift/{camera_id}/reset-baseline")
async def reset_baseline(camera_id: str) -> dict:
    """Forget a camera's baseline after a deliberate change (moved, re-lensed)."""
    ok = shadow.get_drift().reset_baseline(camera_id)
    return {"camera_id": camera_id, "reset": ok,
            "note": "the next completed window becomes the new baseline"}


# ==================================================================== harvest
class HarvestStartIn(BaseModel):
    target: int = Field(400, ge=20, le=5000)
    min_interval_s: float = Field(8.0, ge=0.0, le=300.0)


@router.post("/harvest/start")
async def harvest_start(body: HarvestStartIn) -> dict:
    """Begin collecting golden-set candidates from every running camera.

    Deliberately NOT the uncertainty sampler that feeds training. That one picks
    frames the model is unsure about, which is right for learning and wrong for
    measuring: a test set drawn from a model's own weak spots gives a number
    that is pessimistic, unstable, and not comparable across versions. This
    stratifies by condition instead — time of day, scene brightness, occupancy,
    camera — so the set resembles the plant rather than the model's blind spots.
    """
    from app.services import harvest

    return harvest.start(target=body.target, min_interval_s=body.min_interval_s)


@router.post("/harvest/stop")
async def harvest_stop() -> dict:
    from app.services import harvest

    return harvest.stop()


@router.get("/harvest/status")
async def harvest_status() -> dict:
    """Progress, coverage, and — most usefully — what the set still cannot measure."""
    from app.services import harvest

    s = harvest.get_session()
    if s is None:
        async with SessionLocal() as session:
            pending = int(await session.scalar(
                select(func.count()).select_from(CaptureItem)
                .where(CaptureItem.harvest_tag == "golden-candidate")
                .where(CaptureItem.status == CaptureStatus.pending)) or 0)
        return {"running": False, "awaiting_labels": pending,
                "hint": ("Start a harvest, or sweep existing recordings — a "
                         "month of footage already contains the night shifts "
                         "and weather you would otherwise wait a month to see.")}
    out = s.snapshot()
    out["running"] = True
    return out


class SweepIn(BaseModel):
    camera_id: str = ""
    start: str = ""
    end: str = ""
    target: int = Field(200, ge=10, le=2000)
    per_segment: int = Field(3, ge=1, le=20)


@router.post("/harvest/sweep")
async def harvest_sweep(body: SweepIn) -> dict:
    """Pull golden candidates out of recordings already on disk.

    The fast path to coverage. Collecting live means waiting for night, for
    rain, for a crowded shift; the recordings already contain all of it.
    """
    from app.services import harvest

    return await harvest.sweep_recordings(
        camera_id=body.camera_id, start_iso=body.start, end_iso=body.end,
        target=body.target, per_segment=body.per_segment)


@router.get("/harvest/queue")
async def harvest_queue(limit: int = Query(50, ge=1, le=500)) -> dict:
    """Harvested frames waiting to be labelled, rarest classes first.

    Ordering matters: another hundred helmet frames add nothing once helmet is
    covered, while one harness frame may be the difference between a gate that
    can see the class and one that cannot.
    """
    from sqlalchemy.orm import selectinload

    async with SessionLocal() as session:
        rows = list((await session.execute(
            select(CaptureItem)
            .where(CaptureItem.harvest_tag == "golden-candidate")
            .where(CaptureItem.status == CaptureStatus.pending)
            .options(selectinload(CaptureItem.labels))
            .order_by(CaptureItem.created_at.desc())
            .limit(400))).scalars())
        golden = await evaluation.build_golden_set(session)

    support = golden.class_support
    items = []
    for it in rows:
        predicted = sorted({(p or {}).get("cls") for p in (it.predictions or [])
                            if (p or {}).get("cls")})
        need = max((max(0, evaluation.MIN_SUPPORT_TO_GATE * 3 - support.get(c, 0))
                    for c in predicted), default=0)
        items.append({
            "capture_id": it.id, "camera_id": it.camera_id,
            "created_at": it.created_at.isoformat() if it.created_at else None,
            "note": it.note, "predicted_classes": predicted, "value": need,
            "image_url": f"/api/review/image/{it.id}",
        })
    items.sort(key=lambda x: (-x["value"], x["capture_id"]))
    return {"queue": items[:limit], "total_pending": len(rows),
            "golden_support": support,
            "next_step": ("Label these in Review, then mark them golden in "
                          "Model Ops -> Golden set. They are excluded from "
                          "training the moment they are marked.")}


# ==================================================================== summary
@router.get("/summary")
async def summary() -> dict:
    """One call for the Model Ops dashboard header."""
    from app.ml.detector import get_detector
    from app.routers.models import _load

    reg = _load()
    async with SessionLocal() as session:
        golden = await evaluation.build_golden_set(session)
        run_count = int(await session.scalar(
            select(func.count()).select_from(EvalRun)) or 0)
        latest = list((await session.execute(
            select(EvalRun).where(EvalRun.status == EvalStatus.done)
            .order_by(EvalRun.created_at.desc()).limit(5))).scalars())
        pending_verdicts = int(await session.scalar(
            select(func.count()).select_from(ShadowVerdict)
            .where(ShadowVerdict.adjudicated == "")) or 0)

    live_weights = get_detector().active_weights
    live_sha = evaluation.weights_fingerprint(live_weights)
    live_run = next((r for r in latest if r.weights_sha == live_sha
                     and r.golden_sha == golden.sha), None)
    return {
        "golden": golden.as_dict(),
        "golden_ready": golden.images >= 5,
        "live_weights": live_weights,
        "live_scored": live_run is not None,
        "live_map50": live_run.map50 if live_run else None,
        "active_version": reg.get("active"),
        "eval_runs": run_count,
        "recent_runs": [{
            "id": r.id, "label": r.model_label, "map50": r.map50,
            "golden_version": r.golden_version,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in latest],
        "shadow": shadow.shadow_status(),
        "pending_adjudications": pending_verdicts,
    }
