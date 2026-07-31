"""
In-app fine-tuning: label -> export -> train -> evaluate -> activate, one call.

Until now the loop stopped halfway. An operator could correct boxes in Review &
Teach and export a dataset, but the last three steps lived in
ppe_upgrade/train_cli.py and had to be run by hand on a terminal, then the
weights copied onto the server. In practice that meant labels were collected
and never trained on, so correcting the model had no visible effect and people
stopped correcting it.

This service closes the loop in-process. One job at a time (training saturates
the machine, and two runs would fight over the same registry), on a daemon
thread so the API stays responsive, with per-epoch progress the dashboard can
poll. On success it registers the checkpoint in the SAME registry the model zoo
uses and activates it, which copies it over ppe_active.pt and hot-reloads the
shared detector — every running camera picks up the new model on its next
frame, no restart. That is the "instantly applicable" requirement.

Safety: `promote_only_if_better` (default on) evaluates the challenger and
refuses to activate a checkpoint that scores worse than the model currently
live. A single afternoon of thin labels should not be able to silently make a
plant-wide safety system blinder than it was this morning.
"""
from __future__ import annotations

import threading
import time
import traceback
from dataclasses import asdict, dataclass, field
from pathlib import Path

from app.core.config import get_settings


@dataclass
class TrainJob:
    job_id: str
    state: str = "queued"          # queued|exporting|training|evaluating|done|failed|cancelled
    step: str = ""
    epoch: int = 0
    epochs: int = 0
    progress: float = 0.0          # 0..1 over the whole job
    dataset_version: str = ""
    images: int = 0
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    weights: str = ""
    metrics: dict = field(default_factory=dict)
    baseline_metrics: dict = field(default_factory=dict)
    registered_version: int | None = None
    activated: bool = False
    promoted_reason: str = ""
    # The golden-set verdict: challenger vs incumbent on identical held-out
    # frames, with the per-class regressions that blocked (or did not block)
    # promotion. Empty when no golden set exists yet.
    gate: dict = field(default_factory=dict)
    error: str = ""
    log: list[str] = field(default_factory=list)

    def say(self, msg: str) -> None:
        self.step = msg
        self.log.append(f"{time.strftime('%H:%M:%S')}  {msg}")
        del self.log[:-200]        # bounded; the dashboard only shows the tail

    def as_dict(self) -> dict:
        d = asdict(self)
        d["elapsed_s"] = round((self.finished_at or time.time()) - self.started_at, 1)
        d["running"] = self.state in ("queued", "exporting", "training", "evaluating")
        return d


class TrainingService:
    """One job at a time. Thread-safe."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._job: TrainJob | None = None
        self._cancel = threading.Event()
        self._thread: threading.Thread | None = None

    # ---- introspection ----------------------------------------------------
    @property
    def job(self) -> TrainJob | None:
        return self._job

    def status(self) -> dict:
        job = self._job
        return {"job": job.as_dict() if job else None,
                "busy": bool(job and job.as_dict()["running"])}

    def cancel(self) -> bool:
        """Ask the running job to stop at the next epoch boundary."""
        job = self._job
        if not job or not job.as_dict()["running"]:
            return False
        self._cancel.set()
        job.say("cancel requested — stopping after this epoch")
        return True

    # ---- launch -----------------------------------------------------------
    def start(self, *, epochs: int = 50, imgsz: int = 640, base: str = "",
              dataset_version: str = "", promote_only_if_better: bool = True,
              auto_activate: bool = True, note: str = "") -> dict:
        with self._lock:
            if self._job and self._job.as_dict()["running"]:
                raise RuntimeError(
                    f"training already running (job {self._job.job_id}, "
                    f"{self._job.state})")
            job_id = time.strftime("t%Y%m%d%H%M%S")
            job = TrainJob(job_id=job_id, epochs=int(epochs),
                           dataset_version=dataset_version or f"v{job_id}")
            job.say("queued")
            self._job = job
            self._cancel.clear()
            self._thread = threading.Thread(
                target=self._run, name=f"ppe-train-{job_id}", daemon=True,
                kwargs={"job": job, "imgsz": int(imgsz), "base": base,
                        "promote_only_if_better": bool(promote_only_if_better),
                        "auto_activate": bool(auto_activate), "note": note})
            self._thread.start()
        return job.as_dict()

    # ---- worker -----------------------------------------------------------
    def _run(self, *, job: TrainJob, imgsz: int, base: str,
             promote_only_if_better: bool, auto_activate: bool, note: str) -> None:
        try:
            data_yaml = self._export(job)
            weights = self._train(job, data_yaml, imgsz, base)
            if weights is None:                     # cancelled
                job.state = "cancelled"
                job.finished_at = time.time()
                return
            job.weights = str(weights)
            self._evaluate_and_publish(job, weights, data_yaml, imgsz,
                                       promote_only_if_better, auto_activate, note)
            job.state = "done"
            job.progress = 1.0
        except Exception as exc:                    # noqa: BLE001 - reported to UI
            job.state = "failed"
            job.error = f"{type(exc).__name__}: {exc}"
            job.say(f"FAILED: {job.error}")
            job.log.append(traceback.format_exc()[-1500:])
        finally:
            job.finished_at = time.time()

    # -- step 1: dataset ----------------------------------------------------
    def _export(self, job: TrainJob) -> Path:
        """Bake every human-labeled capture into a YOLO dataset on disk.

        Runs the existing async export through the app's event loop so the
        labeled->exported status transition happens exactly once, in the same
        session semantics the review API uses.
        """
        job.state = "exporting"
        job.say(f"exporting labeled captures -> dataset {job.dataset_version}")

        import asyncio

        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, \
            create_async_engine

        from app.services.review_service import get_review_service

        async def _do() -> dict:
            # A private engine for this thread's loop. The module-level engine
            # in app.core.db pools connections bound to the API's event loop;
            # driving it from a worker thread's fresh loop is how you get an
            # export that hangs forever instead of failing.
            engine = create_async_engine(get_settings().DATABASE_URL, future=True)
            maker = async_sessionmaker(engine, class_=AsyncSession,
                                       expire_on_commit=False)
            try:
                async with maker() as session:
                    return await get_review_service().export_yolo(
                        session, job.dataset_version)
            finally:
                await engine.dispose()

        manifest = asyncio.run(_do())
        job.images = int(manifest.get("exported_items") or 0)
        ds_dir = Path(manifest["dataset_dir"])

        # export_yolo only writes NEWLY labeled captures, so a second run would
        # otherwise train on an almost-empty folder. Count what is actually on
        # disk and fold in every earlier dataset version, which is also what
        # makes each round of corrections cumulative rather than a reset.
        data_yaml = self._merge_previous(job, ds_dir)
        on_disk = len(list((ds_dir / "images").glob("*.jpg")))
        job.images = on_disk
        if on_disk < 8:
            raise RuntimeError(
                f"only {on_disk} labeled image(s) available — label at least 8 "
                f"frames in Review & Teach first (30+ gives a usable model)")
        job.say(f"dataset ready: {on_disk} images")
        job.progress = 0.05
        return data_yaml

    def _merge_previous(self, job: TrainJob, ds_dir: Path) -> Path:
        """Copy earlier dataset versions in, then write a train/val data.yaml.

        Without a val split ultralytics validates on the training images and
        every metric reads ~1.0, which would make the promotion gate below
        meaningless.
        """
        import shutil

        s = get_settings()
        img_dir, lbl_dir = ds_dir / "images", ds_dir / "labels"
        img_dir.mkdir(parents=True, exist_ok=True)
        lbl_dir.mkdir(parents=True, exist_ok=True)
        merged = 0
        for prev in sorted(s.DATASETS_DIR.iterdir()):
            if not prev.is_dir() or prev.resolve() == ds_dir.resolve():
                continue
            for img in (prev / "images").glob("*.jpg"):
                lbl = prev / "labels" / f"{img.stem}.txt"
                if not lbl.exists() or (img_dir / img.name).exists():
                    continue
                shutil.copy2(img, img_dir / img.name)
                shutil.copy2(lbl, lbl_dir / lbl.name)
                merged += 1
        if merged:
            job.say(f"merged {merged} image(s) from earlier dataset versions")

        from app.ml import taxonomy

        # Split by a hash of the filename, not by position in the list.
        #
        # The previous version took `images[:n_val]` — the oldest 20% of a pool
        # that grows every run. As the pool grew, n_val grew with it, so images
        # that had been TRAINED on in run N were reassigned to VAL in run N+1.
        # Since the default base weights are the currently-live checkpoint, the
        # model being validated had already fitted those exact frames, and the
        # resulting metric climbed run over run regardless of whether the model
        # got better. Hashing the name pins each image to one side permanently,
        # so the split is stable no matter how the pool grows.
        #
        # This number is still only the training split's own score. The
        # trustworthy comparison is the golden set (see evaluation.py), which
        # holds frames out of training entirely; this one exists to show
        # convergence during the run.
        import hashlib

        def _is_val(name: str) -> bool:
            digest = hashlib.sha256(name.encode()).digest()
            return digest[0] % 5 == 0            # ~20%, stable forever

        images = sorted(p.name for p in img_dir.glob("*.jpg"))
        val_names = {n for n in images if _is_val(n)} if len(images) >= 5 else set()
        # A hash split can land empty on a tiny pool; fall back rather than
        # write an empty val list, which makes ultralytics validate on train.
        if not val_names and len(images) >= 5:
            val_names = {images[0]}
        val_list = ds_dir / "val.txt"
        train_list = ds_dir / "train.txt"
        train_list.write_text("\n".join(
            str(img_dir / n) for n in images if n not in val_names))
        val_list.write_text("\n".join(
            str(img_dir / n) for n in sorted(val_names or set(images))))
        job.say(f"split: {len(images) - len(val_names)} train / "
                f"{len(val_names)} val (stable hash split)")

        names_block = "\n".join(
            f"  {i}: {n}" for i, n in enumerate(taxonomy.CANONICAL_CLASSES))
        data_yaml = ds_dir / "data.yaml"
        data_yaml.write_text(
            f"path: {ds_dir}\ntrain: {train_list}\nval: {val_list}\n"
            f"nc: {len(taxonomy.CANONICAL_CLASSES)}\nnames:\n{names_block}\n")
        return data_yaml

    # -- step 2: train ------------------------------------------------------
    def _resolve_base(self, base: str) -> str:
        """What to fine-tune FROM.

        Default is the checkpoint currently live: its backbone already knows
        this plant's helmets and vests, so a few dozen corrected frames go much
        further than they would from generic COCO weights. Ultralytics rebuilds
        the detection head when the class count differs (our canonical
        taxonomy has 21 classes, SH17 ships 17), keeping the backbone — which
        is exactly the transfer we want.
        """
        if base:
            return base
        s = get_settings()
        for p in sorted(s.WEIGHTS_DIR.glob("ppe_active.*"),
                        key=lambda x: x.stat().st_mtime, reverse=True):
            if p.suffix.lower() == ".pt" and p.stat().st_size > 1000:
                return str(p)
        # Prefer SH17 plant weights on disk over generic COCO / demo css-data.
        zoo = s.WEIGHTS_DIR / "zoo"
        for key in ("sh17-yolo9m", "sh17-yolo9e", "sh17-yolo8s", "hexmon-vyra"):
            p = zoo / f"{key}.pt"
            if p.exists() and p.stat().st_size > 1_000_000:
                return str(p)
        # An ONNX active model cannot be fine-tuned; fall back to base weights.
        return s.BASE_WEIGHTS

    def _train(self, job: TrainJob, data_yaml: Path, imgsz: int,
               base: str) -> Path | None:
        job.state = "training"
        target = self._resolve_base(base)
        job.say(f"training {job.epochs} epochs from {Path(target).name} "
                f"(imgsz={imgsz}, device={get_settings().DEVICE})")

        from ultralytics import YOLO

        model = YOLO(target)

        def on_epoch_end(trainer) -> None:
            job.epoch = int(getattr(trainer, "epoch", 0)) + 1
            job.progress = 0.05 + 0.8 * (job.epoch / max(1, job.epochs))
            job.say(f"epoch {job.epoch}/{job.epochs}")
            if self._cancel.is_set():
                trainer.stop = True          # ultralytics honours this flag

        model.add_callback("on_train_epoch_end", on_epoch_end)

        s = get_settings()
        results = model.train(
            data=str(data_yaml), epochs=job.epochs, imgsz=imgsz,
            device=s.DEVICE if s.DEVICE != "mps" else "mps",
            project=str(s.DATA_DIR / "runs"), name=job.job_id,
            patience=max(5, job.epochs // 4), exist_ok=True, verbose=False,
            plots=False,
        )
        if self._cancel.is_set():
            job.say("cancelled")
            return None
        best = Path(str(getattr(results, "save_dir", ""))) / "weights" / "best.pt"
        if not best.exists():
            raise RuntimeError(f"training finished but {best} was not written")
        job.progress = 0.85
        job.say(f"trained: {best}")
        return best

    # -- step 3: evaluate, register, activate -------------------------------
    def _gate_on_golden(self, job: TrainJob, weights: Path, imgsz: int) -> dict | None:
        """Score challenger AND incumbent on the frozen golden set.

        This is the honest version of the promotion check. The previous one
        logged "scoring the live model on the same split" and then read a number
        off the registry that had been measured on a different split in a
        different run — two datasets compared as though they were one, which
        could not detect a regression and reported that it had checked.

        Here both models are actually run, on identical held-out frames that
        neither has ever trained on. Returns None when there is no usable golden
        set, and the caller falls back to the old registry comparison rather
        than blocking a promotion the operator asked for.
        """
        import asyncio

        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, \
            create_async_engine

        from app.services import evaluation

        async def _do() -> dict | None:
            engine = create_async_engine(get_settings().DATABASE_URL, future=True)
            maker = async_sessionmaker(engine, class_=AsyncSession,
                                       expire_on_commit=False)
            try:
                async with maker() as session:
                    golden = await evaluation.build_golden_set(session)
                    if golden.images < 5:
                        return None
                    job.say(f"golden set: {golden.images} held-out frame(s), "
                            f"{golden.instances} labelled instance(s) "
                            f"[{golden.version}]")

                    job.say("scoring challenger on the golden set")
                    ch = evaluation.score_model(weights, golden.data_yaml, imgsz)
                    await evaluation.record_run(
                        session, weights=str(weights),
                        label=f"challenger {job.job_id}",
                        golden=golden.as_dict(), scores=ch, imgsz=imgsz,
                        trigger="training")

                    # The incumbent: the weights actually serving cameras now.
                    live = self._live_weights()
                    inc = None
                    if live and Path(live).exists():
                        sha = evaluation.weights_fingerprint(live)
                        prior = await evaluation.latest_run_for(
                            session, sha, golden.sha)
                        if prior is not None:
                            job.say("reusing the live model's score on this "
                                    "golden set (same weights, same frames)")
                            inc = await evaluation.run_to_scores(session, prior)
                        else:
                            job.say("scoring the LIVE model on the same golden "
                                    "set for a like-for-like comparison")
                            inc = evaluation.score_model(
                                live, golden.data_yaml, imgsz)
                            await evaluation.record_run(
                                session, weights=str(live), label="live model",
                                golden=golden.as_dict(), scores=inc,
                                imgsz=imgsz, trigger="training")
                    else:
                        job.say("no live checkpoint on disk to compare against")

                    verdict = evaluation.compare(ch, inc, golden.class_support)
                    verdict["challenger"] = ch
                    verdict["incumbent"] = inc
                    verdict["golden"] = golden.as_dict()
                    return verdict
            finally:
                await engine.dispose()

        try:
            return asyncio.run(_do())
        except Exception as exc:  # noqa: BLE001 - never fail a good training run
            job.say(f"golden-set gate unavailable ({type(exc).__name__}: {exc}) "
                    f"— falling back to the validation split")
            return None

    @staticmethod
    def _live_weights() -> str:
        s = get_settings()
        for p in sorted(s.WEIGHTS_DIR.glob("ppe_active.*"),
                        key=lambda x: x.stat().st_mtime, reverse=True):
            if p.suffix.lower() == ".pt" and p.stat().st_size > 1000:
                return str(p)
        return ""

    def _evaluate_and_publish(self, job: TrainJob, weights: Path, data_yaml: Path,
                              imgsz: int, promote_only_if_better: bool,
                              auto_activate: bool, note: str) -> None:
        job.state = "evaluating"
        job.say("evaluating challenger on the validation split")
        job.metrics = self._metrics(weights, data_yaml, imgsz)
        job.progress = 0.9

        from app.routers.models import _activate, _load, _save

        reg = _load()
        active_entry = next(
            (v for v in reg["versions"] if v["version"] == reg.get("active")), None)
        job.baseline_metrics = (active_entry or {}).get("metrics") or {}

        promote = auto_activate
        reason = "auto-activate off" if not auto_activate else "activated"
        gate = self._gate_on_golden(job, weights, imgsz) if (
            auto_activate and promote_only_if_better) else None
        job.gate = gate or {}

        if gate is not None:
            # Golden-set verdict: both models measured on identical held-out
            # frames. This is the only comparison that can actually detect a
            # regression, so it wins over the split-based one outright.
            job.metrics = {**job.metrics, "golden": gate["challenger"]}
            job.baseline_metrics = gate.get("incumbent") or {}
            promote = bool(gate["promote"])
            if promote:
                reason = "; ".join(gate["reasons"]) or "golden-set gate passed"
            else:
                reason = "kept the live model — " + "; ".join(gate["blocking"])
        elif auto_activate and promote_only_if_better and self._baseline_comparable(
                job.baseline_metrics):
            # No golden set yet. Say so honestly rather than implying the
            # comparison is like-for-like: these two numbers come from different
            # validation splits and only a large gap means anything.
            job.say("no golden set — comparing validation-split scores, which "
                    "were measured on DIFFERENT frames. Mark some reviewed "
                    "frames as golden to get a real regression check.")
            new = float(job.metrics.get("map50") or 0.0)
            old = float(job.baseline_metrics.get("map50") or 0.0)
            if new < old:
                promote = False
                reason = (f"kept the live model: mAP50 {new:.3f} < {old:.3f} "
                          f"(different splits — indicative only)")
            else:
                reason = (f"mAP50 {new:.3f} >= live {old:.3f} "
                          f"(different splits — indicative only)")
        elif auto_activate and promote_only_if_better:
            reason = "no comparable baseline metrics — promoted (bootstrap)"

        from app.ml import taxonomy

        version = max((v["version"] for v in reg["versions"]), default=0) + 1
        reg["versions"].append({
            "version": version,
            "weights": str(weights),
            "note": note or (f"self-trained {job.job_id}: {job.images} labeled "
                             f"frames, {job.epoch} epochs"),
            "metrics": job.metrics,
            "ts": time.time(),
            "zoo_key": "self-trained",
            "classes": list(taxonomy.CANONICAL_CLASSES),
            "job_id": job.job_id,
            "dataset": job.dataset_version,
            # The held-out score, kept separate from `metrics` (which is the
            # validation-split number) so the two are never mistaken for each
            # other again. This is the one that is comparable across versions.
            "golden": (gate or {}).get("challenger", {}).get("map50"),
            "golden_version": (gate or {}).get("golden", {}).get("version", ""),
        })
        _save(reg)
        job.registered_version = version
        job.say(f"registered as model version {version}")

        if promote:
            _activate(reg, version)      # copies to ppe_active.pt + detector.reload()
            job.activated = True
            job.say("ACTIVE — every running camera uses it from the next frame")
        else:
            job.say(f"registered but not activated ({reason})")
        job.promoted_reason = reason

    @staticmethod
    def _baseline_comparable(baseline: dict) -> bool:
        """Only gate on a baseline that was measured the same way we measure.

        Zoo models carry `metrics: {}` — comparing against a missing number
        would mean the first self-trained model could never be promoted.
        """
        return bool(baseline) and baseline.get("map50") is not None

    @staticmethod
    def _metrics(weights: Path, data_yaml: Path, imgsz: int) -> dict:
        from ultralytics import YOLO

        res = YOLO(str(weights)).val(data=str(data_yaml), imgsz=imgsz,
                                     verbose=False, plots=False)
        box = getattr(res, "box", None)
        return {
            "map50": round(float(getattr(box, "map50", 0.0) or 0.0), 4),
            "map50_95": round(float(getattr(box, "map", 0.0) or 0.0), 4),
            "precision": round(float(getattr(box, "mp", 0.0) or 0.0), 4),
            "recall": round(float(getattr(box, "mr", 0.0) or 0.0), 4),
            "evaluated_at": time.time(),
        }


_service: TrainingService | None = None
_service_lock = threading.Lock()


def get_training_service() -> TrainingService:
    global _service
    if _service is None:
        with _service_lock:
            if _service is None:
                _service = TrainingService()
    return _service
