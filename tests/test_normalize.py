from datetime import date

from integra.geo import county_for_zip
from integra.normalize import (
    address_key,
    canonical_first_name,
    clean_person_name,
    domain_of,
    name_key,
    normalize_address_line,
    normalize_credential_text,
    normalize_phone,
    parse_date,
    street_number,
    zip5,
    zip9,
)
from integra.specialty import derive_specialty, specialty_for_code


def test_phone_to_e164():
    assert normalize_phone("808-737-3311") == "+18087373311"
    assert normalize_phone("(425) 922-8504") == "+14259228504"
    assert normalize_phone("8087373311") == "+18087373311"
    assert normalize_phone("123") is None
    assert normalize_phone(None) is None


def test_zip_codes():
    assert zip5("968163712") == "96816"
    assert zip5("98007-1234") == "98007"
    assert zip9("968163712") == "96816-3712"
    assert zip9("96816") == "96816"
    assert zip5("123") is None


def test_person_names_strip_credentials_and_expand_nicknames():
    assert clean_person_name("Dr. William  Smith, D.D.S.") == "william smith"
    assert canonical_first_name("Bill") == "william"
    assert canonical_first_name("C DWIGHT") == "c"
    assert name_key("Mike", "O'Brien") == "michael|o brien"
    assert name_key("MICHAEL J.", "OBRIEN") == "michael|obrien"


def test_credential_text():
    assert normalize_credential_text("D.D.S.") == "DDS"
    assert normalize_credential_text("DMD, MS") == "DMD MS"
    assert normalize_credential_text(None) is None


def test_address_normalization():
    assert normalize_address_line("715 S. King Street, Suite 425") == "715 S KING ST STE 425"
    kapiolani = normalize_address_line("1441 Kapiolani Boulevard Ste 706")
    assert kapiolani == "1441 KAPIOLANI BLVD STE 706"
    assert address_key("715 S KING ST STE 425", "968133021") == "715 S KING ST STE 425|96813"
    assert address_key(None, "96813") is None
    assert street_number("45-1144 KAMEHAMEHA HWY STE 401") == "45-1144"
    assert street_number("PSC 808 BOX 19") is None


def test_dates():
    assert parse_date("2009-11-30") == date(2009, 11, 30)
    assert parse_date("05/27/2022") == date(2022, 5, 27)
    assert parse_date("") is None
    assert parse_date("not a date") is None


def test_domain_of():
    assert domain_of("https://www.example.com/contact?x=1") == "example.com"
    assert domain_of("frontdesk@Example.com") == "example.com"
    assert domain_of(None) is None


def test_specialty_derivation():
    assert specialty_for_code("1223P0700X") == "prosth"
    assert specialty_for_code("1223X0400X") == "ortho"
    assert specialty_for_code("1223D0004X") == "other"
    assert specialty_for_code("204E00000X") is None
    assert derive_specialty("122300000X", ["1223P0700X"]) == "gp"
    assert derive_specialty("390200000X", ["390200000X", "1223G0001X"]) == "gp"
    assert derive_specialty("204E00000X", ["1223S0112X", "122300000X"]) == "os"
    assert derive_specialty("208600000X", []) is None


def test_hawaii_counties():
    assert county_for_zip("HI", "96813") == "Honolulu"
    assert county_for_zip("HI", "967933210") == "Maui"
    assert county_for_zip("HI", "96766") == "Kauai"
    assert county_for_zip("HI", "96720") == "Hawaii"
    assert county_for_zip("WA", "98007") is None
