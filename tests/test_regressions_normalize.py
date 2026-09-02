"""Regression tests for the 2026-09-02 review fixes in integra.normalize (see CHANGELOG.md).

Pure functions, no database: surnames that double as credential tokens, suite folding in
address keys, and the pruned nickname table.
"""

from __future__ import annotations

import pytest

from integra.normalize import (
    address_key,
    canonical_first_name,
    clean_person_name,
    name_key,
    normalize_address_line,
)

KING_STREET_KEY = "715 S KING ST STE 425|96813"


@pytest.mark.parametrize("surname", ["Do", "Ma", "Ba", "Sr"])
def test_surname_that_is_also_a_credential_token_is_kept(surname: str) -> None:
    assert clean_person_name(surname) == surname.lower()


def test_name_key_keeps_a_credential_like_surname() -> None:
    assert name_key("Anh", "Do") == "anh|do"
    assert name_key("Wei", "Ma") == "wei|ma"


def test_credential_suffix_is_still_dropped_from_a_real_name() -> None:
    assert clean_person_name("Smith DDS") == "smith"
    assert name_key("John", "Smith, D.D.S.") == "john|smith"


def test_address_key_folds_the_suite_from_line2() -> None:
    folded = address_key("715 S KING ST", "968133021", "SUITE 425")
    assert folded == KING_STREET_KEY
    assert folded == address_key("715 S KING ST STE 425", "96813")


@pytest.mark.parametrize("designator", ["#425", "UNIT 425", "Suite 425"])
def test_unit_designators_all_normalize_to_ste(designator: str) -> None:
    assert normalize_address_line(f"715 S King St {designator}") == "715 S KING ST STE 425"
    assert address_key("715 S KING ST", "96813", designator) == KING_STREET_KEY


def test_bill_still_expands_to_william() -> None:
    assert canonical_first_name("Bill") == "william"
    assert name_key("Bill", "Williams") == "william|williams"


@pytest.mark.parametrize("name", ["Pat", "Chris", "Sam", "Alex", "Terry", "Steven"])
def test_ambiguous_short_forms_are_not_expanded(name: str) -> None:
    assert canonical_first_name(name) == name.lower()
