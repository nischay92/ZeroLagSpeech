from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from zerolag_sidecar.app import create_app
from zerolag_sidecar.config import Settings

TEST_TOKEN = "sidecar-test-token-123"
AUDIO_FORMAT = {
    "encoding": "pcm_s16le",
    "sample_rate_hz": 16000,
    "channels": 1,
}


def test_websocket_rejects_missing_token() -> None:
    app = create_app(Settings(environment="test", token=TEST_TOKEN))

    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as rejection:
            with client.websocket_connect(f"/ws/session/{uuid4()}"):
                pass

    assert rejection.value.code == 1008


def test_mock_session_stream_is_ordered_and_completes() -> None:
    app = create_app(Settings(environment="test", token=TEST_TOKEN))
    session_id = uuid4()

    with TestClient(app) as client:
        with client.websocket_connect(f"/ws/session/{session_id}?token={TEST_TOKEN}") as websocket:
            connected = websocket.receive_json()
            websocket.send_json({"type": "start", "audio": AUDIO_FORMAT})
            streaming = websocket.receive_json()
            websocket.send_bytes(b"\x00\x01" * 160)
            transcript = websocket.receive_json()
            websocket.send_json({"type": "stop"})
            inference = websocket.receive_json()
            completed = websocket.receive_json()

    events = [connected, streaming, transcript, inference, completed]
    assert [event["sequence"] for event in events] == list(range(5))
    assert [event["event"] for event in events] == [
        "session.connected",
        "session.status",
        "transcript.segment",
        "inference.result",
        "session.completed",
    ]
    assert all(event["protocol_version"] == "1.0" for event in events)
    assert all(event["session_id"] == str(session_id) for event in events)
    assert completed["data"]["audio_bytes"] == 320


def test_invalid_audio_format_returns_protocol_error() -> None:
    app = create_app(Settings(environment="test", token=TEST_TOKEN))

    with TestClient(app) as client:
        with client.websocket_connect(f"/ws/session/{uuid4()}?token={TEST_TOKEN}") as websocket:
            websocket.receive_json()
            websocket.send_json(
                {
                    "type": "start",
                    "audio": {"encoding": "pcm_s16le", "sample_rate_hz": 44100, "channels": 2},
                }
            )
            error = websocket.receive_json()

    assert error["event"] == "error"
    assert error["data"]["code"] == "invalid_command"
