import asyncio
import json
import os
from uuid import uuid4

import httpx
import websockets

HOST = "127.0.0.1"
PORT = 43110


async def verify_websocket(token: str) -> None:
    session_id = uuid4()
    url = f"ws://{HOST}:{PORT}/ws/session/{session_id}?token={token}"
    async with websockets.connect(url) as socket:
        connected = json.loads(await socket.recv())
        await socket.send(
            json.dumps(
                {
                    "type": "start",
                    "audio": {
                        "encoding": "pcm_s16le",
                        "sample_rate_hz": 16000,
                        "channels": 1,
                    },
                }
            )
        )
        streaming = json.loads(await socket.recv())
        await socket.send(b"\x00\x01" * 160)
        transcript = json.loads(await socket.recv())
        await socket.send(json.dumps({"type": "stop"}))
        inference = json.loads(await socket.recv())
        completed = json.loads(await socket.recv())

    events = [connected, streaming, transcript, inference, completed]
    assert [event["sequence"] for event in events] == list(range(5))
    assert completed["event"] == "session.completed"


async def main() -> None:
    token = os.environ.get("ZEROLAG_SIDECAR_TOKEN", "local-development-token")
    async with httpx.AsyncClient(base_url=f"http://{HOST}:{PORT}") as client:
        response = await client.get("/health")
        response.raise_for_status()
        assert response.json()["protocol_version"] == "1.0"

    await verify_websocket(token)
    print("Sidecar HTTP and WebSocket smoke test passed.")


if __name__ == "__main__":
    asyncio.run(main())
