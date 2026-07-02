import enum
import uuid

from sqlalchemy import Boolean, Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, TimestampMixin


class CredentialMode(str, enum.Enum):
    ZEROLAG = "zerolag"
    PERSONAL = "personal"


class ProviderCredential(TimestampMixin, Base):
    __tablename__ = "provider_credentials"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    provider_name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    credential_mode: Mapped[CredentialMode] = mapped_column(
        Enum(CredentialMode, name="credential_mode", native_enum=False), nullable=False
    )
    encrypted_value: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # TODO(security): Encrypt/decrypt through a dedicated secret-management interface before
    # accepting personal provider credentials. Never persist plaintext API keys.
