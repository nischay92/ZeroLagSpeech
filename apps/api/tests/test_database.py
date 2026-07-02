import uuid

import pytest
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database.base import Base
from app.database.health import database_is_healthy
from app.models import (
    Artifact,
    CredentialMode,
    Insight,
    ProviderCredential,
    Session,
    SessionStatus,
    TranscriptSegment,
)


def test_metadata_contains_phase_two_tables() -> None:
    assert set(Base.metadata.tables) == {
        "sessions",
        "transcript_segments",
        "insights",
        "artifacts",
        "provider_credentials",
    }

    transcript_foreign_keys = inspect(TranscriptSegment).local_table.foreign_keys
    assert {foreign_key.target_fullname for foreign_key in transcript_foreign_keys} == {
        "sessions.id"
    }


@pytest.mark.asyncio
async def test_models_persist_with_relationships() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    session_id = uuid.uuid4()
    async with factory() as database_session:
        recording = Session(id=session_id, title="Architecture review")
        recording.transcript_segments.append(
            TranscriptSegment(
                speaker="Speaker 1",
                text="Let us begin.",
                sequence_number=1,
                started_at_ms=0,
                ended_at_ms=900,
                is_final=True,
            )
        )
        recording.insights.append(
            Insight(insight_type="decision", content="Use a modular monolith.")
        )
        recording.artifacts.append(
            Artifact(artifact_type="summary", title="Summary", content={"items": []})
        )
        database_session.add(recording)
        database_session.add(
            ProviderCredential(
                provider_name="deepgram",
                credential_mode=CredentialMode.PERSONAL,
                encrypted_value=None,
            )
        )
        await database_session.commit()

        loaded = await database_session.scalar(select(Session).where(Session.id == session_id))
        assert loaded is not None
        assert loaded.status is SessionStatus.CREATED

    await engine.dispose()


@pytest.mark.asyncio
async def test_database_health_check() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    assert await database_is_healthy(engine) is True
    await engine.dispose()


@pytest.mark.asyncio
async def test_database_health_check_handles_unavailable_database() -> None:
    engine = create_async_engine("sqlite+aiosqlite:////directory-that-does-not-exist/db.sqlite")
    assert await database_is_healthy(engine) is False
    await engine.dispose()
