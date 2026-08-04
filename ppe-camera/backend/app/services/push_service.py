"""
Outbound violation push: plant PC -> cloud dashboard.

The agent is the system of record. The cloud is a read-only window onto a
*subset* of it, and this module is the only thing that connects the two. Three
properties are deliberate:

  * **Outbound only.** The cloud never calls the agent. Everything here is an
    HTTPS POST originating inside the plant network, so the deployment needs no
    inbound firewall rule, no port forward and no tunnel — which is the
    difference between "IT approves this" and "IT does not".

  * **Manual by default.** PPE_AUTO_SYNC is off unless someone turns it on.
    Pushing plant surveillance data to a public cloud is a decision an operator
    makes deliberately, not a default they discover afterwards. The timer, when
    enabled, is a convenience on top of the button — never a replacement.

  * **The queue is a column, not a table.** `ViolationEvent.synced_at IS NULL`
    IS the outbox. A separate outbox table would need to be kept consistent
    with the violations it mirrors, and the failure mode of that drifting is
    silently unsent evidence. One nullable column cannot drift.

Because `ViolationEvent.id` is a uuid4 minted at the edge, the cloud upserts on
it: a batch that half-succeeded before the network dropped can simply be pushed
again. There is no cursor to corrupt and no ack protocol to get wrong.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import func, select

from app.core.config import get_settings

log = logging.getLogger(__name__)

# Module state for the status endpoint. In-memory on purpose: it describes this
# process's activity, not durable history, and a restart legitimately clears it.
_state: dict = {
    "running": False,
    "last_push_at": None,
    "last_ok": None,
    "last_error": "",
    "last_sent": 0,
    "auto_task": None,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _jpeg_for(ev, predictions: list | None) -> bytes | None:
    """The annotated evidence frame, downscaled for transport.

    The cloud has no OpenCV and no access to the plant filesystem, so the red
    violation box has to be burnt in here. Reusing the viewer's own annotator
    keeps the pushed image identical to what the operator reviewed locally —
    if those two ever diverge, the dashboard is quietly showing something
    different to management than the plant saw.
    """
    try:
        import cv2
        import numpy as np

        from app.routers.violations import _annotate

        s = get_settings()
        path = Path(ev.image_path) if ev.image_path else None
        if path is None or not path.exists():
            return None

        raw = _annotate(path, ev, predictions)
        if raw is None:
            raw = path.read_bytes()

        img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return None
        h, w = img.shape[:2]
        if w > s.SYNC_THUMB_WIDTH:
            scale = s.SYNC_THUMB_WIDTH / float(w)
            img = cv2.resize(img, (s.SYNC_THUMB_WIDTH, max(1, int(h * scale))),
                             interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(
            ".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), s.SYNC_THUMB_QUALITY])
        return buf.tobytes() if ok else None
    except Exception as exc:  # noqa: BLE001 - a missing image must not block the row
        log.warning("could not build thumbnail for violation %s: %s",
                    getattr(ev, "id", "?"), exc)
        return None


async def _serialize(session, ev) -> dict:
    """One violation as the cloud expects it, image included."""
    import base64

    predictions = None
    if ev.capture_id:
        try:
            from app.models.review import CaptureItem

            cap = await session.get(CaptureItem, ev.capture_id)
            if cap is not None:
                predictions = cap.predictions
        except Exception:  # noqa: BLE001
            predictions = None

    jpeg = await asyncio.to_thread(_jpeg_for, ev, predictions)
    return {
        "id": ev.id,
        "camera_id": ev.camera_id,
        "rule_type": ev.rule_type,
        "gear": ev.gear,
        "track_id": ev.track_id,
        "person_key": ev.person_key,
        "confidence": ev.confidence,
        "person_box": list(ev.person_box or []),
        "department": ev.department,
        "shift": ev.shift,
        "status": ev.status.value if hasattr(ev.status, "value") else str(ev.status),
        "occurred_at": ev.occurred_at.isoformat() if ev.occurred_at else None,
        "thumb_b64": base64.b64encode(jpeg).decode("ascii") if jpeg else None,
        # Accountability travels with the violation. Assignment happens on the
        # agent (that is where the safety officer is standing); the cloud shows
        # management who owns what. Re-assigning clears synced_at, so the row
        # comes back through this queue and the cloud copy stays current.
        "assigned_to": ev.assigned_to or "",
        "assigned_to_id": ev.assigned_to_id,
        "contractor_id": ev.contractor_id,
        "assigned_by": ev.assigned_by or "",
        "assigned_at": ev.assigned_at.isoformat() if ev.assigned_at else None,
        "due_at": ev.due_at.isoformat() if ev.due_at else None,
        "assignment_note": ev.assignment_note or "",
        "resolution_note": ev.resolution_note or "",
        "resolved_by": ev.resolved_by or "",
        "resolved_at": ev.resolved_at.isoformat() if ev.resolved_at else None,
    }


async def pending_query(session, *, camera_id: str | None = None,
                        since: datetime | None = None,
                        until: datetime | None = None,
                        rule_type: str | None = None):
    """The unsent queue, optionally narrowed.

    The filters exist so an operator can choose what leaves the plant — one
    camera, one shift, one date range — rather than being forced into
    all-or-nothing. Consent over a surveillance feed is not a binary.
    """
    from app.models.domain import ViolationEvent

    stmt = select(ViolationEvent).where(ViolationEvent.synced_at.is_(None))
    if camera_id:
        stmt = stmt.where(ViolationEvent.camera_id == camera_id)
    if rule_type:
        stmt = stmt.where(ViolationEvent.rule_type == rule_type)
    if since:
        stmt = stmt.where(ViolationEvent.occurred_at >= since)
    if until:
        stmt = stmt.where(ViolationEvent.occurred_at <= until)
    return stmt.order_by(ViolationEvent.occurred_at)


async def pending_count(session, **filters) -> int:
    """How many violations are waiting. Drives the badge on the push button."""
    from app.models.domain import ViolationEvent

    stmt = await pending_query(session, **filters)
    total = await session.execute(
        select(func.count()).select_from(stmt.subquery())
    )
    return int(total.scalar() or 0)


async def push_now(*, limit: int | None = None, dry_run: bool = False,
                   **filters) -> dict:
    """Send pending violations to the cloud. Returns a report, never raises.

    Chunked because a four-hour backlog on a busy site is thousands of rows:
    one request carrying all of them exceeds every proxy timeout in the path and
    then retries forever, sending nothing. Each chunk is committed as it is
    accepted, so an interrupted push keeps the ground it gained.
    """
    import httpx

    from app.core.db import SessionLocal

    s = get_settings()
    if not s.SYNC_URL or not s.AGENT_ID or not s.AGENT_TOKEN:
        return {"ok": False, "sent": 0, "pending": 0,
                "error": "sync not configured (set PPE_SYNC_URL, PPE_AGENT_ID, "
                         "PPE_AGENT_TOKEN)"}
    if _state["running"]:
        return {"ok": False, "sent": 0, "error": "a push is already running"}

    _state["running"] = True
    sent = 0
    errors: list[str] = []
    try:
        async with SessionLocal() as session:
            remaining = await pending_count(session, **filters)
            if dry_run:
                return {"ok": True, "sent": 0, "pending": remaining,
                        "dry_run": True}

            url = f"{s.SYNC_URL}/api/sync/violations"
            headers = {"X-Agent-Id": s.AGENT_ID, "X-Agent-Token": s.AGENT_TOKEN}
            budget = remaining if limit is None else min(limit, remaining)

            async with httpx.AsyncClient(timeout=s.SYNC_TIMEOUT_S) as client:
                while sent < budget:
                    take = min(s.SYNC_BATCH, budget - sent)
                    stmt = await pending_query(session, **filters)
                    rows = (await session.execute(stmt.limit(take))).scalars().all()
                    if not rows:
                        break

                    payload = {
                        "agent_id": s.AGENT_ID,
                        "violations": [await _serialize(session, ev) for ev in rows],
                    }
                    try:
                        resp = await client.post(url, json=payload, headers=headers)
                    except Exception as exc:  # noqa: BLE001 - network, expected
                        errors.append(f"network: {exc}")
                        break
                    if resp.status_code >= 400:
                        errors.append(f"HTTP {resp.status_code}: {resp.text[:200]}")
                        break

                    # Stamp only what the cloud actually acknowledged. Marking a
                    # row synced that was rejected loses it permanently: nothing
                    # ever selects it again.
                    accepted = set((resp.json() or {}).get("accepted") or
                                   [r.id for r in rows])
                    stamp = _now()
                    for ev in rows:
                        if ev.id in accepted:
                            ev.synced_at = stamp
                    await session.commit()

                    n = sum(1 for ev in rows if ev.id in accepted)
                    sent += n
                    if n == 0:
                        errors.append("cloud accepted nothing from this batch")
                        break

            pending = await pending_count(session, **filters)
    except Exception as exc:  # noqa: BLE001 - a push must never take the agent down
        log.exception("push failed")
        errors.append(str(exc))
        pending = -1
    finally:
        _state["running"] = False

    ok = not errors
    _state.update({
        "last_push_at": _now().isoformat(),
        "last_ok": ok,
        "last_error": "; ".join(errors),
        "last_sent": sent,
    })
    log.info("push complete: sent=%d ok=%s %s", sent, ok, "; ".join(errors))
    return {"ok": ok, "sent": sent, "pending": pending,
            "error": "; ".join(errors)}


async def _auto_loop() -> None:
    """Opt-in timer. Sleeps first so a restart loop cannot become a push loop."""
    s = get_settings()
    while True:
        try:
            await asyncio.sleep(s.SYNC_INTERVAL_S)
            log.info("auto-sync tick")
            await push_now()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - the timer outlives any single failure
            log.exception("auto-sync tick failed")


def start_auto_sync() -> bool:
    """Start the timer if PPE_AUTO_SYNC is on. Returns whether it started."""
    s = get_settings()
    if not s.AUTO_SYNC:
        return False
    if _state.get("auto_task") is not None:
        return True
    _state["auto_task"] = asyncio.create_task(_auto_loop())
    log.info("auto-sync enabled: every %ds", s.SYNC_INTERVAL_S)
    return True


def stop_auto_sync() -> None:
    task = _state.get("auto_task")
    if task is not None and not task.done():
        task.cancel()
    _state["auto_task"] = None


def status() -> dict:
    s = get_settings()
    return {
        "configured": bool(s.SYNC_URL and s.AGENT_ID and s.AGENT_TOKEN),
        "sync_url": s.SYNC_URL,
        "agent_id": s.AGENT_ID,
        "auto_sync": s.AUTO_SYNC,
        "auto_running": _state.get("auto_task") is not None,
        "interval_s": s.SYNC_INTERVAL_S,
        "batch_size": s.SYNC_BATCH,
        "pushing": _state["running"],
        "last_push_at": _state["last_push_at"],
        "last_ok": _state["last_ok"],
        "last_error": _state["last_error"],
        "last_sent": _state["last_sent"],
    }
