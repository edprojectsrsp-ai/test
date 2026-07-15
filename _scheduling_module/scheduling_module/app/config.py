"""Configuration and async database engine."""
from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv


load_dotenv()


def _database_url() -> str:
    value = os.environ.get("SCHED_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not value:
        return "postgresql+asyncpg://postgres:postgres@localhost:5432/project_brain"
    if value.startswith("postgresql+psycopg2://"):
        return value.replace("postgresql+psycopg2://", "postgresql+asyncpg://", 1)
    if value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+asyncpg://", 1)
    return value


class Settings:
    DATABASE_URL: str = _database_url()
    API_PREFIX: str = "/api/scheduling"
    NEAR_CRITICAL_WD: int = int(os.environ.get("SCHED_NEAR_CRITICAL", "5"))


@lru_cache
def get_settings() -> Settings:
    return Settings()
