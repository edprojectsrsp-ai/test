"""FastAPI application entrypoint for the Scheduling & Project Control module.

Mount into the host app with:
    from scheduling_module.app.api.routes import router as scheduling_router
    app.include_router(scheduling_router)
or run standalone:  uvicorn app.main:app --port 8003
"""
from __future__ import annotations

from fastapi import FastAPI

from .api.routes import router as scheduling_router

app = FastAPI(title="Scheduling & Project Control Module", version="0.1.0")
app.include_router(scheduling_router)


@app.get("/health")
async def health():
    return {"status": "ok", "module": "scheduling"}
