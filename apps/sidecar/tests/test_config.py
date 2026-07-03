import pytest

from zerolag_sidecar.config import Settings


def test_rejects_non_loopback_binding() -> None:
    settings = Settings(host="0.0.0.0", token="a-secure-test-token")

    with pytest.raises(ValueError, match="loopback"):
        settings.validate_runtime_security()


def test_packaged_mode_rejects_default_token() -> None:
    settings = Settings(environment="packaged")

    with pytest.raises(ValueError, match="per-launch"):
        settings.validate_runtime_security()
