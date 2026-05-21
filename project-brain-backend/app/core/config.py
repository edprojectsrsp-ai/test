import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "Project Brain API"
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://postgres:abc123@localhost:5432/project_brain")
    SECRET_KEY: str = "your-super-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    AI_DEFAULT_PROVIDER: str = os.getenv("AI_DEFAULT_PROVIDER", "openai")
    AI_DEFAULT_MODEL: str = os.getenv("AI_DEFAULT_MODEL", "")

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
