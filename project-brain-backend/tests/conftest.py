"""Test environment.

Importing app.api.v1.dpr pulls in the database module, which raises at import
time if DATABASE_URL is unset. That is a wider design issue — a router should
be importable without a live database — but pinning a URL here keeps the
contract tests runnable, since they only inspect Pydantic models and query
text and never open a connection. The backend rejects SQLite outright, so a
Postgres URL is used; nothing ever dials it.
"""
import os

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://test:test@127.0.0.1:5432/test_project_brain")
