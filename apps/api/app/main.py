from fastapi import FastAPI

from app.config import get_settings

settings = get_settings()
app = FastAPI(title="ZeroLag API", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, str]:
    """Return process health; dependency checks arrive in later phases."""
    # TODO(phase-2/3): Include database and Redis dependency health.
    return {"status": "ok", "environment": settings.app_env}
