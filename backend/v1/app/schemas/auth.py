"""Request and response models for the authentication endpoints.

Length bounds here mirror the constants in ``app.security.passwords`` so that a
bad password is rejected as a clean 422 before it reaches the hashing code.
The *domain* rule for emails is not enforced here — it lives in
``app.services.auth_service.normalise_email``, so there is exactly one place
that decides what an ACME address is.
"""

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import CurrentUserRead, UserRead
from app.security.passwords import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH

PasswordField = Field(
    min_length=MIN_PASSWORD_LENGTH,
    max_length=MAX_PASSWORD_LENGTH,
    description=f"Between {MIN_PASSWORD_LENGTH} and {MAX_PASSWORD_LENGTH} characters.",
)


class RegisterRequest(BaseModel):
    """Self-registration. The resulting account is always an EMPLOYEE."""

    model_config = ConfigDict(extra="ignore")

    email: str = Field(min_length=3, max_length=320, description="An @acme.inc address.")
    full_name: str = Field(min_length=1, max_length=120)
    password: str = PasswordField


class LoginRequest(BaseModel):
    """Email and password. Both wrong-email and wrong-password give one answer."""

    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


class ChangePasswordRequest(BaseModel):
    """Change the caller's own password. Requires proving the current one."""

    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str = PasswordField


class TokenResponse(BaseModel):
    """What login and refresh return.

    The refresh token is deliberately absent: it travels only in an HttpOnly
    cookie, so JavaScript can never read it.
    """

    access_token: str = Field(description="JWT bearer token, valid for 15 minutes.")
    token_type: str = Field(default="bearer")
    user: UserRead


class RegisterResponse(BaseModel):
    """What registration returns. No tokens — the client then logs in."""

    user: UserRead


class MessageResponse(BaseModel):
    """A bare acknowledgement for endpoints with nothing else to say."""

    detail: str


class MeResponse(BaseModel):
    """The caller's own record, including their engineer profile if any."""

    user: CurrentUserRead
