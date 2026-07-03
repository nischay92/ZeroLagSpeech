from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class EventName(StrEnum):
    CONNECTED = "session.connected"
    STATUS = "session.status"
    TRANSCRIPT = "transcript.segment"
    INFERENCE = "inference.result"
    LATENCY = "latency.updated"
    COMPLETED = "session.completed"
    ERROR = "error"


class AudioFormat(BaseModel):
    encoding: Literal["pcm_s16le"] = "pcm_s16le"
    sample_rate_hz: Literal[16000] = 16000
    channels: Literal[1] = 1


class StartCommand(BaseModel):
    type: Literal["start"]
    audio: AudioFormat


class StopCommand(BaseModel):
    type: Literal["stop"]


class PingCommand(BaseModel):
    type: Literal["ping"]


class EventEnvelope(BaseModel):
    protocol_version: Literal["1.0"] = "1.0"
    event: EventName
    session_id: UUID
    sequence: int = Field(ge=0)
    timestamp: datetime
    data: dict[str, Any]


class EventStream:
    """Create ordered protocol events for one desktop session."""

    def __init__(self, session_id: UUID) -> None:
        self.session_id = session_id
        self._sequence = 0

    def create(self, event: EventName, data: dict[str, Any]) -> EventEnvelope:
        envelope = EventEnvelope(
            event=event,
            session_id=self.session_id,
            sequence=self._sequence,
            timestamp=datetime.now(UTC),
            data=data,
        )
        self._sequence += 1
        return envelope
