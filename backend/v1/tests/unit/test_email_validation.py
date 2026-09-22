"""The @acme.inc registration rule, including lookalike domains.

This is the highest-value unit test in the auth layer: the rule is one string
comparison, and every way of getting it subtly wrong is a way of letting an
outsider into the platform.
"""

import pytest

from app.errors import ValidationError
from app.services.auth_service import ALLOWED_EMAIL_DOMAIN, normalise_email


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("person@acme.inc", "person@acme.inc"),
        ("  person@acme.inc  ", "person@acme.inc"),
        ("Person@ACME.Inc", "person@acme.inc"),
        ("PERSON@ACME.INC", "person@acme.inc"),
        ("first.last@acme.inc", "first.last@acme.inc"),
        ("first+tag@acme.inc", "first+tag@acme.inc"),
        ("first-last_1@acme.inc", "first-last_1@acme.inc"),
    ],
)
def test_valid_addresses_are_normalised(raw: str, expected: str) -> None:
    assert normalise_email(raw) == expected


@pytest.mark.parametrize(
    ("raw", "why"),
    [
        ("person@acme.inc.evil.com", "acme.inc as a prefix of a longer domain"),
        ("person@sub.acme.inc", "a subdomain of acme.inc"),
        ("person@notacme.inc", "acme.inc as a suffix of a longer domain"),
        ("person@acme.inco", "one extra character"),
        ("person@acme.in", "one missing character"),
        ("person@acmeinc", "the dot removed"),
        ("person@acme.inc.", "a trailing dot"),
        ("person@.acme.inc", "a leading dot"),
        # The first letter of the domain is U+0430 CYRILLIC SMALL LETTER A,
        # not an ASCII "a". That is the point of the case.
        ("person@аcme.inc", "a Cyrillic homograph"),  # noqa: RUF001
        ("person@gmail.com", "an unrelated domain"),
    ],
)
def test_lookalike_domains_are_rejected(raw: str, why: str) -> None:
    with pytest.raises(ValidationError) as caught:
        normalise_email(raw)

    assert caught.value.field == "email", why
    assert caught.value.status_code == 422


@pytest.mark.parametrize(
    ("raw", "why"),
    [
        ("person@acme.inc@evil.com", "the attacker's domain last"),
        ("person@evil.com@acme.inc", "the allowed domain last"),
        ("a@b@c@acme.inc", "several @ signs"),
    ],
)
def test_multiple_at_signs_are_rejected(raw: str, why: str) -> None:
    """Splitting on the first vs. the last @ must not be exploitable either way."""
    with pytest.raises(ValidationError) as caught:
        normalise_email(raw)

    assert caught.value.code == "INVALID_EMAIL", why


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "person",
        "@acme.inc",
        "person@",
        "person name@acme.inc",
        "person..name@acme.inc",
        ".person@acme.inc",
        "person.@acme.inc",
        "pers<on@acme.inc",
    ],
)
def test_malformed_addresses_are_rejected(raw: str) -> None:
    with pytest.raises(ValidationError):
        normalise_email(raw)


def test_local_part_length_is_capped() -> None:
    """RFC 5321 caps the local part at 64 characters."""
    assert normalise_email("a" * 64 + f"@{ALLOWED_EMAIL_DOMAIN}")

    with pytest.raises(ValidationError):
        normalise_email("a" * 65 + f"@{ALLOWED_EMAIL_DOMAIN}")


def test_rejection_message_names_the_domain() -> None:
    """The message has to tell an employee what went wrong."""
    with pytest.raises(ValidationError) as caught:
        normalise_email("person@gmail.com")

    assert ALLOWED_EMAIL_DOMAIN in caught.value.detail
    assert caught.value.code == "INVALID_EMAIL_DOMAIN"
