from integra.config import Settings, source_config


def test_source_config_merges_defaults():
    cfg = source_config("nppes")
    assert cfg.rate_limit_per_sec == 1.0
    assert cfg.max_attempts == 5
    assert cfg.get("page_size") == 200
    assert cfg.get("states")["HI"] == ["967", "968"]
    slow = source_config("hi_dcca")
    assert slow.rate_limit_per_sec == 0.5


def test_wa_doh_business_fields_exclude_birthyear():
    cfg = source_config("wa_doh")
    assert "birthyear" not in cfg.get("business_fields")


def test_secret_helper_never_returns_empty(monkeypatch):
    s = Settings(_env_file=None, hunter_api_key="   ")
    assert s.secret("hunter_api_key") is None
    s2 = Settings(_env_file=None, hunter_api_key="abc")
    assert s2.secret("hunter_api_key") == "abc"
    assert "abc" not in repr(s2)
