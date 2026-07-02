from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import get_settings
from app.database.health import database_is_healthy
from app.database.session import close_database

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await close_database()


app = FastAPI(title="ZeroLag API", version="0.2.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    """Return process and configured dependency health."""
    database_status = "disabled"
    status = "ok"
    if settings.database_required:
        database_status = "ok" if await database_is_healthy() else "unavailable"
        status = "ok" if database_status == "ok" else "degraded"

    # TODO(phase-3): Include Redis dependency health.
    return {
        "status": status,
        "environment": settings.app_env,
        "database": database_status,
    }
