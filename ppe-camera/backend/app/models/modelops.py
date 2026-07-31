"""
Model-operations models -- the evidence trail behind "is the model better?".

Until now that question had no answer. A training run measured itself on a
validation split it had helped choose, stored one aggregate number, and the
promotion gate compared that number against one measured on entirely different
data from a previous run. These tables replace the guess with a record.

    EvalRun          one model scored on one frozen golden set, at one moment
    EvalClassMetric  the same run broken out per class — because a model can
                     lift overall mAP while collapsing on the one class that
                     matters, and the aggregate will happily hide it
    ShadowVerdict    a candidate model's disagreement with the live model on a
                     real frame the live model actually processed
    DriftSample      a periodic fingerprint of what a camera is seeing, so a
                     scene that changes under a fixed model gets noticed

Deliberately append-only. An evaluation is a historical fact: re-scoring the
same model on the same golden set later is a NEW run, not an edit of the old
one, because the code around it has moved. Overwriting would destroy the only
record of what was true when a promotion decision was made.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _uid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class EvalStatus(str, enum.Enum):
    running = "running"
    done = "done"
    failed = "failed"


class EvalRun(Base):
    """One model, one golden set, one score."""

    __tablename__ = "eval_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    # What was scored. `weights_path` is the file; `model_version` links it back
    # to the registry when the model came from there.
    weights_path: Mapped[str] = mapped_column(Text, default="")
    weights_sha: Mapped[str] = mapped_column(String(64), default="", index=True)
    model_version: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    model_label: Mapped[str] = mapped_column(String(128), default="")

    # What it was scored ON. The fingerprint pins the exact frame set, so a run
    # measured against a 40-frame golden set is never silently compared with one
    # measured against 200 frames.
    golden_version: Mapped[str] = mapped_column(String(64), default="", index=True)
    golden_images: Mapped[int] = mapped_column(Integer, default=0)
    golden_sha: Mapped[str] = mapped_column(String(64), default="", index=True)

    status: Mapped[EvalStatus] = mapped_column(
        SAEnum(EvalStatus), default=EvalStatus.running, index=True)
    # Aggregates, kept alongside the per-class rows for cheap listing.
    map50: Mapped[float] = mapped_column(Float, default=0.0)
    map50_95: Mapped[float] = mapped_column(Float, default=0.0)
    precision: Mapped[float] = mapped_column(Float, default=0.0)
    recall: Mapped[float] = mapped_column(Float, default=0.0)
    # Confusion matrix as {"rows": [...], "labels": [...]} — what gets mistaken
    # for what, which is the only view that explains a recall drop.
    confusion: Mapped[dict] = mapped_column(JSON, default=dict)
    imgsz: Mapped[int] = mapped_column(Integer, default=640)
    conf: Mapped[float] = mapped_column(Float, default=0.25)
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    trigger: Mapped[str] = mapped_column(String(32), default="manual")  # manual|training|shadow
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


class EvalClassMetric(Base):
    """Per-class breakdown of one EvalRun."""

    __tablename__ = "eval_class_metrics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("eval_runs.id", ondelete="CASCADE"), index=True)
    cls_name: Mapped[str] = mapped_column(String(48), index=True)
    # Support: how many ground-truth instances of this class the golden set has.
    # Without it a class with 2 instances looks as authoritative as one with 200,
    # and a promotion gate keyed on the former is noise.
    support: Mapped[int] = mapped_column(Integer, default=0)
    precision: Mapped[float] = mapped_column(Float, default=0.0)
    recall: Mapped[float] = mapped_column(Float, default=0.0)
    map50: Mapped[float] = mapped_column(Float, default=0.0)
    map50_95: Mapped[float] = mapped_column(Float, default=0.0)


class ShadowVerdict(Base):
    """One frame where a candidate model disagreed with the live model.

    Only disagreements are stored. Agreement is the overwhelming majority and
    carries no information a counter cannot hold; the disagreements are the
    entire point, because they are both the evidence for promotion and a
    perfectly targeted labelling queue.
    """

    __tablename__ = "shadow_verdicts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    camera_id: Mapped[str] = mapped_column(String(64), index=True)
    candidate_label: Mapped[str] = mapped_column(String(128), default="", index=True)
    image_path: Mapped[str] = mapped_column(Text, default="")
    # "candidate_found"  candidate saw gear/violation the live model missed
    # "live_found"       live model saw something the candidate missed
    # "class_conflict"   both saw a box, disagreed on what it was
    kind: Mapped[str] = mapped_column(String(24), default="", index=True)
    cls_name: Mapped[str] = mapped_column(String(48), default="", index=True)
    live_boxes: Mapped[list] = mapped_column(JSON, default=list)
    candidate_boxes: Mapped[list] = mapped_column(JSON, default=list)
    severity: Mapped[float] = mapped_column(Float, default=0.0)
    # Set once a human says who was right — this is what turns shadow mode from
    # an interesting readout into training data.
    adjudicated: Mapped[str] = mapped_column(String(16), default="", index=True)
    capture_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)


class DriftSample(Base):
    """A periodic fingerprint of what one camera is actually seeing.

    Model quality decays without the model changing at all: a camera gets moved,
    a lamp fails, winter arrives and everyone puts on jackets that read as vests.
    Nothing in an offline metric can see that. Comparing today's distribution
    against this camera's own established baseline can.
    """

    __tablename__ = "drift_samples"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    camera_id: Mapped[str] = mapped_column(String(64), index=True)
    window_start: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    window_s: Mapped[float] = mapped_column(Float, default=0.0)
    frames: Mapped[int] = mapped_column(Integer, default=0)
    # Mean detections per frame, mean confidence, and the per-class rate. A
    # collapse in any of them against baseline is the signal.
    detections_per_frame: Mapped[float] = mapped_column(Float, default=0.0)
    mean_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    persons_per_frame: Mapped[float] = mapped_column(Float, default=0.0)
    class_rates: Mapped[dict] = mapped_column(JSON, default=dict)
    mean_brightness: Mapped[float] = mapped_column(Float, default=0.0)
    # Populated once this camera has a baseline to compare against.
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    drift_score: Mapped[float] = mapped_column(Float, default=0.0)
    drift_reason: Mapped[str] = mapped_column(Text, default="")
    weights_sha: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
