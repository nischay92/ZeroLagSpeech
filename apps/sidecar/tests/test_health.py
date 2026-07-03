from fastapi.testclient import TestClient

from zerolag_sidecar.app import create_app
from zerolag_sidecar.config import Settings

TEST_TOKEN = "sidecar-test-token-123"


def test_health_reports_protocol_and_mock_providers() -> None:
    app = create_app(Settings(environment="test", token=TEST_TOKEN))

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "protocol_version": "1.0",
        "providers": {"speech": "mock", "inference": "mock"},
    }


def test_http_rejects_non_loopback_client() -> None:
    app = create_app(Settings(environment="test", token=TEST_TOKEN))

    with TestClient(app, client=("203.0.113.10", 50000)) as client:
        response = client.get("/health")

    assert response.status_code == 403
