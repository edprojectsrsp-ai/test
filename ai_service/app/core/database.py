import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

load_dotenv()

env_database_url = os.getenv("DATABASE_URL")
env_project_db = os.getenv("PROJECT_BRAIN_DB_URL")
DATABASE_URL = env_database_url or env_project_db
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Set DATABASE_URL (or PROJECT_BRAIN_DB_URL) to a PostgreSQL connection string."
    )

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
