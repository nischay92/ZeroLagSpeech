from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.database.session import engine


async def database_is_healthy(database_engine: AsyncEngine = engine) -> bool:
    """Return whether PostgreSQL accepts a trivial query."""
    try:
        async with database_engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception:  # Connection errors are represented as health state, not API failures.
        return False
    return True
