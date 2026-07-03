from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: Literal["development", "test", "packaged"] = "development"
    host: str = "127.0.0.1"
    port: int = 43110
    token: str = "zerolag-development-token"

    model_config = SettingsConfigDict(
        env_prefix="ZEROLAG_SIDECAR_",
        env_file=".env",
        extra="ignore",
    )

    def validate_runtime_security(self) -> None:
        if self.host not in {"127.0.0.1", "::1", "localhost"}:
            raise ValueError("The ZeroLag sidecar may only bind to a loopback address")
        if self.environment == "packaged" and self.token == "zerolag-development-token":
            raise ValueError("Packaged sidecars require a per-launch authentication token")
        if len(self.token) < 16:
            raise ValueError("Sidecar authentication tokens must be at least 16 characters")


@lru_cache
def get_settings() -> Settings:
    return Settings()
