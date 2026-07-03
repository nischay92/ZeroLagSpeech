import uvicorn

from zerolag_sidecar.config import get_settings


def main() -> None:
    settings = get_settings()
    settings.validate_runtime_security()
    uvicorn.run(
        "zerolag_sidecar.app:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
        # WebSocket URLs carry the one-time launch token, so access logs stay disabled.
        access_log=False,
    )


if __name__ == "__main__":
    main()
