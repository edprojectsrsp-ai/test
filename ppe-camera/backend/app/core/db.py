"""
Async database engine + session factory.

SQLite by default (zero setup, runs anywhere), Postgres in production by
setting PPE_DATABASE_URL. Same code, same models, both work -- the only
Postgres-specific niceties (JSONB) degrade gracefully to JSON on SQLite.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

settings = get_settings()

engine = create_async_engine(settings.DATABASE_URL, echo=False, future=True)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    """Create tables. Import models first so they register on Base.metadata."""
    from app.models import review  # noqa: F401  (registers tables)
    from app.models import domain  # noqa: F401  (master-data tables)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

