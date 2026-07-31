"""
Async database engine + session factory.

SQLite by default (zero setup, runs anywhere), Postgres in production by
setting PPE_DATABASE_URL. Same code, same models, both work -- the only
Postgres-specific niceties (JSONB) degrade gracefully to JSON on SQLite.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

settings = get_settings()

def _engine_kwargs() -> dict:
    """SQLite needs telling to wait for a writer instead of failing at one.

    This system has many concurrent writers by design — a heartbeat per camera,
    recorder segment rows, shadow verdicts, drift samples, captures — and
    SQLite's default behaviour on a held write lock is to raise
    "database is locked" immediately rather than wait. Under load that surfaces
    as random lost captures and health rows, which look like unrelated bugs.

    busy_timeout makes writers queue for up to 15 seconds. It does not make
    SQLite concurrent — it makes contention slow instead of fatal, which is the
    right trade here. Postgres (PPE_DATABASE_URL) remains the answer for a real
    multi-camera deployment.
    """
    if not settings.DATABASE_URL.startswith("sqlite"):
        return {}
    return {"connect_args": {"timeout": 15}}


engine = create_async_engine(settings.DATABASE_URL, echo=False, future=True,
                             **_engine_kwargs())
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


@event.listens_for(engine.sync_engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record) -> None:
    """WAL + a busy timeout on every SQLite connection.

    WAL lets readers proceed while a writer holds the lock, which matters here
    because the dashboard polls several endpoints every few seconds against the
    same file the camera workers are writing to. Without it a single in-flight
    capture blocks every read, and the UI reports the service as down.
    """
    if not settings.DATABASE_URL.startswith("sqlite"):
        return
    try:
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=15000")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()
    except Exception:  # noqa: BLE001 - never block a connection over a pragma
        pass


async def init_db() -> None:
    """Create tables. Import models first so they register on Base.metadata."""
    from app.models import review  # noqa: F401  (registers tables)
    from app.models import domain  # noqa: F401  (master-data tables)
    from app.models import nvr     # noqa: F401  (recording index)
    from app.models import modelops  # noqa: F401  (eval / shadow / drift)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)


def _add_missing_columns(conn) -> None:
    """Additively reconcile existing tables with the current models.

    create_all() only ever CREATEs — it never ALTERs. So a column added to a
    model after the SQLite file was first written simply does not exist, and
    every statement touching that table fails at runtime. That is what happened
    to cameras.monitoring_zones / detection_rule / priority: restore_fleet
    logged "no such column" on every boot and CameraWorker._persist swallowed
    the same error on every save, so cameras and their tuned thresholds could
    never survive a restart.

    Only additive, nullable/defaulted columns are handled here — that covers
    model drift without pretending to be a migration tool. Anything requiring a
    type change, a drop or a backfill still needs a real migration.
    """
    import logging

    from sqlalchemy import inspect, text

    inspector = inspect(conn)
    existing_tables = set(inspector.get_table_names())
    log = logging.getLogger(__name__)

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        have = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name in have or column.primary_key:
                continue
            if not (column.nullable or column.default is not None
                    or column.server_default is not None):
                log.warning("cannot auto-add NOT NULL column %s.%s — needs a "
                            "migration", table.name, column.name)
                continue
            try:
                ddl = column.type.compile(conn.dialect)
            except Exception:  # noqa: BLE001 - unsupported type, skip quietly
                continue
            try:
                conn.execute(text(
                    f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {ddl}'))
                log.warning("added missing column %s.%s", table.name, column.name)
            except Exception as exc:  # noqa: BLE001 - never block startup
                log.warning("could not add %s.%s: %s", table.name, column.name, exc)

