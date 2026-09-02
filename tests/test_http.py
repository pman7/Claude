import json
from datetime import date

import httpx
import pytest

from integra.http import HTTPFailure, PoliteClient


def make_client(settings, handler, **kw):
    transport = httpx.MockTransport(handler)
    sleeps: list[float] = []
    client = PoliteClient(
        "testsrc",
        settings=settings,
        transport=transport,
        sleep=sleeps.append,
        run_date=date(2026, 9, 2),
        **kw,
    )
    return client, sleeps


def test_get_caches_and_rereads(settings):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        assert request.headers["user-agent"].startswith("IntegraDentalBot")
        return httpx.Response(200, json={"ok": True, "n": calls["n"]})

    client, _ = make_client(settings, handler)
    body, result = client.get_json("https://example.gov/api", {"a": 1})
    assert body == {"ok": True, "n": 1}
    assert result.from_cache is False
    assert result.cache_path is not None
    assert result.cache_path.parent == settings.raw_dir("testsrc") / "2026-09-02"
    envelope = json.loads(result.cache_path.read_text())
    assert envelope["url"] == "https://example.gov/api?a=1"

    body2, result2 = client.get_json("https://example.gov/api", {"a": 1})
    assert body2 == {"ok": True, "n": 1}
    assert result2.from_cache is True
    assert calls["n"] == 1

    forced, _ = make_client(settings, handler, force=True)
    body3, result3 = forced.get_json("https://example.gov/api", {"a": 1})
    assert result3.from_cache is False
    assert body3["n"] == 2


def test_rate_limit_sleeps_between_requests_to_same_host(settings):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"u": str(request.url)})

    client, sleeps = make_client(settings, handler, rate_limit_per_sec=1.0)
    client.get("https://example.gov/a")
    client.get("https://example.gov/b")
    client.get("https://other.gov/c")
    assert len(sleeps) == 1
    assert 0.9 <= sleeps[0] <= 1.0


def test_429_is_retried_with_retry_after(settings):
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] < 3:
            return httpx.Response(429, headers={"Retry-After": "2"}, text="slow down")
        return httpx.Response(200, json={"ok": True})

    client, sleeps = make_client(settings, handler, max_attempts=5)
    body, _ = client.get_json("https://example.gov/x")
    assert body == {"ok": True}
    assert attempts["n"] == 3
    assert sleeps.count(2.0) == 2


def test_404_is_not_retried_and_snapshotted(settings):
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        return httpx.Response(404, text="<html>missing</html>")

    client, _ = make_client(settings, handler, max_attempts=5)
    with pytest.raises(HTTPFailure) as info:
        client.get("https://example.gov/missing")
    assert attempts["n"] == 1
    assert info.value.status_code == 404
    assert info.value.snapshot_path is not None
    assert info.value.snapshot_path.read_text() == "<html>missing</html>"
    assert info.value.snapshot_path.parent == settings.snapshot_dir("testsrc")


def test_500_exhausts_attempts_then_fails_with_snapshot(settings):
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        return httpx.Response(503, text="down")

    client, sleeps = make_client(settings, handler, max_attempts=3, rate_limit_per_sec=0)
    with pytest.raises(HTTPFailure) as info:
        client.get("https://example.gov/flaky")
    assert attempts["n"] == 3
    assert info.value.snapshot_path is not None
    assert len(sleeps) == 2  # exponential backoff between attempts, none after the last


def test_non_json_body_raises_with_snapshot(settings):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>captcha</html>")

    client, _ = make_client(settings, handler)
    with pytest.raises(HTTPFailure) as info:
        client.get_json("https://example.gov/html")
    assert info.value.snapshot_path is not None
