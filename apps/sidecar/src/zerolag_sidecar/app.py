from hmac import compare_digest
from uuid import UUID

from fastapi import FastAPI, Request, WebSocket, WebSocketException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from zerolag_sidecar.config import Settings, get_settings
from zerolag_sidecar.security import is_loopback_host
from zerolag_sidecar.session import run_mock_session

ALLOWED_ORIGINS = [
    "http://127.0.0.1:1420",
    "http://localhost:1420",
    "http://tauri.localhost",
    "tauri://localhost",
]


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime = settings or get_settings()
    runtime.validate_runtime_security()

    app = FastAPI(
        title="ZeroLag Sidecar",
        description="Loopback-only provider process for ZeroLag Desktop",
        version="1.0.0",
    )
    app.state.settings = runtime
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def require_loopback(request: Request, call_next):  # type: ignore[no-untyped-def]
        host = request.client.host if request.client else None
        if not is_loopback_host(host, allow_test_client=runtime.environment == "test"):
            return JSONResponse(status_code=403, content={"detail": "Loopback access only"})
        return await call_next(request)

    @app.get("/health")
    async def health() -> dict:
        return {
            "status": "ok",
            "protocol_version": "1.0",
            "providers": {"speech": "mock", "inference": "mock"},
        }

    @app.websocket("/ws/session/{session_id}")
    async def session_socket(websocket: WebSocket, session_id: UUID, token: str = "") -> None:
        host = websocket.client.host if websocket.client else None
        if not is_loopback_host(host, allow_test_client=runtime.environment == "test"):
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)
        if not token or not compare_digest(token, runtime.token):
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION)

        await websocket.accept()
        await run_mock_session(websocket, session_id)

    return app


app = create_app()
