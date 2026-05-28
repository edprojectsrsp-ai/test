import os

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

# Prefer explicit DATABASE_URL (from .env) over PROJECT_BRAIN_DB_URL environment override.
env_database_url = os.getenv("DATABASE_URL")
env_project_db = os.getenv("PROJECT_BRAIN_DB_URL")
DATABASE_URL = env_database_url or env_project_db
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Set DATABASE_URL (or PROJECT_BRAIN_DB_URL) to a PostgreSQL connection string."
    )
print('\n[app.core.database] Using DATABASE_URL=' + (DATABASE_URL or '<missing>') + '\n')
if DATABASE_URL.startswith("sqlite"):
    raise RuntimeError(
        "SQLite is not supported for this backend. Use PostgreSQL (the schema depends on extensions/views)."
    )
print('\n[app.core.database] env DATABASE_URL=' + (env_database_url or '<none>'))
print('[app.core.database] env PROJECT_BRAIN_DB_URL=' + (env_project_db or '<none>') + '\n')

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
