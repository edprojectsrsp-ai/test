"""Scheduled report push → Telegram.

Runs inside the AI service (same process as the Telegram poller). Every
subscribed chat (tg_push_subscriptions) receives a portfolio — or per-scheme —
CAPEX + physical-progress digest at its send_hour IST, daily or weekly.

Design notes
  · Transport reuses routers.telegram_bot.send (chunking + Markdown already
    handled there). No new Telegram plumbing.
  · Digest SQL is self-contained (this service talks to the same project_brain
    Postgres via BRAIN_DATABASE_URL / DATABASE_URL, like knowledge_graph.py).
  · Idempotent per day: last_sent_on guards double-sends across restarts.
  · Subscription UX: users send /digest, /digest weekly, /digest off to the
    bot — intercepted in telegram_bot.handle_update before the gateway.

Standalone test:  python -m app.services.report_push --preview
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import date, datetime, timedelta, timezone

import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))
_CHECK_EVERY_S = 300  # 5-minute scheduler tick


def _conn():
    dsn = (os.environ.get("PROJECT_BRAIN_DB_URL")
           or os.environ.get("BRAIN_DATABASE_URL") or os.environ.get("DATABASE_URL"))
    if not dsn:
        raise RuntimeError("PROJECT_BRAIN_DB_URL / DATABASE_URL not set")
    return psycopg2.connect(dsn)


# ------------------------------------------------------------------ digest SQL

def _fy_bounds(today: date) -> tuple[str, int]:
    fy_start = today.year if today.month >= 4 else today.year - 1
    return f"{fy_start}-{str(fy_start + 1)[2:]}", fy_start


_PORTFOLIO_SQL = """
WITH plan AS (
  SELECT r.scheme_id,
         SUM(CASE WHEN h.plan_type = 'RE' THEN cmv.re_amount ELSE cmv.be_amount END) AS fy_plan,
         SUM(CASE WHEN cmv.month_no = ANY(%(months)s)
                  THEN CASE WHEN h.plan_type = 'RE' THEN cmv.re_amount ELSE cmv.be_amount END
                  ELSE 0 END) AS plan_to_date
  FROM capex_month_values cmv
  JOIN capex_plan_rows r ON r.id = cmv.plan_row_id
  JOIN capex_plan_header h ON h.id = r.plan_id
  WHERE h.fy_year = %(fy)s
    AND (h.is_effective = 1 OR NOT EXISTS
         (SELECT 1 FROM capex_plan_header h2 WHERE h2.fy_year = %(fy)s AND h2.is_effective = 1))
  GROUP BY r.scheme_id),
act AS (
  SELECT r.scheme_id, SUM(a.amount) AS fy_actual
  FROM capex_actuals a JOIN capex_plan_rows r ON r.id = a.plan_row_id
  WHERE a.fy_year = %(fy)s GROUP BY r.scheme_id)
SELECT s.scheme_id, s.scheme_name,
       COALESCE(p.fy_plan, 0)      AS fy_plan,
       COALESCE(p.plan_to_date, 0) AS plan_to_date,
       COALESCE(a.fy_actual, 0)    AS fy_actual
FROM scheme_master s
LEFT JOIN plan p ON p.scheme_id = s.scheme_id
LEFT JOIN act  a ON a.scheme_id = s.scheme_id
WHERE NOT COALESCE(s.is_deleted, FALSE)
  AND COALESCE(s.current_status, '') NOT IN ('Completed', 'Closed', 'Dropped')
  AND (p.fy_plan IS NOT NULL OR a.fy_actual IS NOT NULL)
  AND (%(scheme_id)s IS NULL OR s.scheme_id = %(scheme_id)s)
ORDER BY s.scheme_id
"""


def build_digest(scheme_id: int | None = None, today: date | None = None) -> str:
    """Markdown digest: FY spend vs plan-to-date, worst achievers flagged."""
    today = today or datetime.now(IST).date()
    fy, fy_start = _fy_bounds(today)
    # calendar month_nos elapsed in this FY (Apr..current)
    elapsed = []
    d = date(fy_start, 4, 1)
    while d <= today:
        elapsed.append(d.month)
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)

    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(_PORTFOLIO_SQL, {"fy": fy, "months": elapsed, "scheme_id": scheme_id})
        rows = cur.fetchall()

    if not rows:
        return f"*Project Brain digest — {today:%d %b %Y}*\nNo active CAPEX data for FY {fy}."

    tot_plan = sum(float(r["fy_plan"]) for r in rows)
    tot_ptd = sum(float(r["plan_to_date"]) for r in rows)
    tot_act = sum(float(r["fy_actual"]) for r in rows)
    ach = (tot_act / tot_ptd * 100) if tot_ptd else 0.0

    def pct(r):
        p = float(r["plan_to_date"])
        return (float(r["fy_actual"]) / p * 100) if p else None

    laggards = sorted((r for r in rows if pct(r) is not None and pct(r) < 90),
                      key=pct)[:5]
    ahead = [r for r in rows if pct(r) is not None and pct(r) >= 100]

    lines = [
        f"*Project Brain digest — {today:%d %b %Y}* (FY {fy})",
        "",
        f"CAPEX: ₹{tot_act:,.1f} Cr spent vs ₹{tot_ptd:,.1f} Cr plan-to-date "
        f"→ *{ach:.0f}% achievement* (FY BE/RE ₹{tot_plan:,.1f} Cr)",
        f"Schemes on/ahead of plan: {len(ahead)} / {len(rows)}",
    ]
    if laggards:
        lines += ["", "*Attention (achievement < 90%):*"]
        for r in laggards:
            lines.append(f"  • {r['scheme_name'][:40]} — "
                         f"₹{float(r['fy_actual']):,.1f} / ₹{float(r['plan_to_date']):,.1f} Cr "
                         f"({pct(r):.0f}%)")
    lines += ["", "_Full EVM board: Project Brain → /evm_"]
    return "\n".join(lines)


# --------------------------------------------------------------- subscriptions

def set_subscription(chat_id: int, cadence: str | None) -> str:
    """cadence 'daily' | 'weekly' | None(=off). Returns confirmation text."""
    with _conn() as conn, conn.cursor() as cur:
        if cadence is None:
            cur.execute("UPDATE tg_push_subscriptions SET is_active = FALSE "
                        "WHERE chat_id = %s", (chat_id,))
            return "Digest off. Send /digest to re-enable."
        cur.execute("""
            INSERT INTO tg_push_subscriptions (chat_id, cadence, is_active)
            VALUES (%s, %s, TRUE)
            ON CONFLICT (chat_id, COALESCE(scheme_id, 0))
            DO UPDATE SET cadence = EXCLUDED.cadence, is_active = TRUE
        """, (chat_id, cadence))
        return (f"Subscribed: *{cadence}* portfolio digest at 07:00 IST. "
                "Send /digest off to stop.")


def handle_digest_command(chat_id: int, text: str) -> str | None:
    """Intercepts '/digest[ off| weekly| daily]'. Returns reply or None."""
    t = (text or "").strip().lower()
    if not t.startswith("/digest"):
        return None
    arg = t.replace("/digest", "", 1).strip()
    if arg in ("off", "stop"):
        return set_subscription(chat_id, None)
    if arg == "weekly":
        return set_subscription(chat_id, "weekly")
    if arg in ("", "on", "daily"):
        return set_subscription(chat_id, "daily")
    return "Usage: /digest · /digest weekly · /digest off"


# ------------------------------------------------------------------- scheduler

def due_subscriptions(now: datetime | None = None) -> list[dict]:
    """Active subs whose send_hour has passed today (IST) and not yet sent
    today; weekly subs only on Mondays."""
    now = now or datetime.now(IST)
    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT id, chat_id, cadence, scheme_id FROM tg_push_subscriptions
            WHERE is_active
              AND send_hour <= %s
              AND (last_sent_on IS NULL OR last_sent_on < %s)
              AND (cadence = 'daily' OR %s = 0)
        """, (now.hour, now.date(), now.weekday()))
        return cur.fetchall()


def mark_sent(sub_id: int, on: date | None = None) -> None:
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("UPDATE tg_push_subscriptions SET last_sent_on = %s WHERE id = %s",
                    (on or datetime.now(IST).date(), sub_id))


async def push_loop(stop: asyncio.Event, sender=None) -> None:
    """Scheduler loop. `sender(chat_id, text)` defaults to the Telegram
    transport; injectable for tests."""
    if sender is None:
        from app.routers.telegram_bot import send as sender  # late import: needs token
    logger.info("Report push scheduler started (tick %ss).", _CHECK_EVERY_S)
    while not stop.is_set():
        try:
            subs = await asyncio.to_thread(due_subscriptions)
            # one digest build per distinct scope, fan out to its chats
            by_scope: dict[int | None, list[dict]] = {}
            for s in subs:
                by_scope.setdefault(s["scheme_id"], []).append(s)
            for scope, ss in by_scope.items():
                text = await asyncio.to_thread(build_digest, scope)
                for s in ss:
                    try:
                        await sender(s["chat_id"], text)
                        await asyncio.to_thread(mark_sent, s["id"])
                    except Exception:
                        logger.exception("Push to chat %s failed", s["chat_id"])
        except Exception:
            logger.exception("Push scheduler tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=_CHECK_EVERY_S)
        except asyncio.TimeoutError:
            pass
    logger.info("Report push scheduler stopped.")


if __name__ == "__main__":
    import sys
    if "--preview" in sys.argv:
        print(build_digest())
