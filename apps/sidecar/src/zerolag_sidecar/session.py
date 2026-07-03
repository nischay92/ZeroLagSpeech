import json
from uuid import UUID

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from zerolag_sidecar.schemas import (
    EventName,
    EventStream,
    PingCommand,
    StartCommand,
    StopCommand,
)


async def send_event(
    websocket: WebSocket, stream: EventStream, event: EventName, data: dict
) -> None:
    await websocket.send_json(stream.create(event, data).model_dump(mode="json"))


async def run_mock_session(websocket: WebSocket, session_id: UUID) -> None:
    stream = EventStream(session_id)
    started = False
    audio_bytes = 0

    await send_event(
        websocket,
        stream,
        EventName.CONNECTED,
        {
            "sidecar": "ready",
            "providers": {"speech": "mock", "inference": "mock"},
        },
    )

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            if payload := message.get("bytes"):
                if not started:
                    await send_event(
                        websocket,
                        stream,
                        EventName.ERROR,
                        {"code": "session_not_started", "message": "Send start before audio"},
                    )
                    continue
                audio_bytes += len(payload)
                await send_event(
                    websocket,
                    stream,
                    EventName.TRANSCRIPT,
                    {
                        "segment_id": f"mock-{audio_bytes}",
                        "speaker": "Speaker 1",
                        "text": f"Mock transcript for {audio_bytes} bytes of audio",
                        "is_final": False,
                    },
                )
                continue

            text = message.get("text")
            if text is None:
                continue
            try:
                command = json.loads(text)
                command_type = command.get("type")
                if command_type == "start":
                    StartCommand.model_validate(command)
                    started = True
                    await send_event(
                        websocket,
                        stream,
                        EventName.STATUS,
                        {"status": "streaming"},
                    )
                elif command_type == "stop":
                    StopCommand.model_validate(command)
                    await send_event(
                        websocket,
                        stream,
                        EventName.INFERENCE,
                        {
                            "artifact_type": "summary",
                            "content": "Mock inference result",
                            "provider": "mock",
                        },
                    )
                    await send_event(
                        websocket,
                        stream,
                        EventName.COMPLETED,
                        {"audio_bytes": audio_bytes},
                    )
                    await websocket.close(code=1000)
                    break
                elif command_type == "ping":
                    PingCommand.model_validate(command)
                    await send_event(
                        websocket,
                        stream,
                        EventName.STATUS,
                        {"status": "alive"},
                    )
                else:
                    raise ValueError("Unknown command type")
            except (json.JSONDecodeError, ValidationError, ValueError) as error:
                await send_event(
                    websocket,
                    stream,
                    EventName.ERROR,
                    {"code": "invalid_command", "message": str(error)},
                )
    except WebSocketDisconnect:
        return
