"""Polite HTTP client: rate limited per host, single concurrency, retried with backoff,
every raw response cached to disk, failures snapshotted.

Rules implemented here (CLAUDE.md sections 2 and 16):
- max N requests per second per host, configured per source
- descriptive User-Agent
- cache every raw response under data/raw/<source>/<YYYY-MM-DD>/ and read from cache on re-runs
- exponential backoff, max attempts from config, honor Retry-After, never retry a 4xx other than 429
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from tenacity import RetryCallState, Retrying, retry_if_exception_type, stop_after_attempt
from tenacity.wait import wait_exponential_jitter

from integra.config import Settings, get_settings
from integra.logging import get_logger

log = get_logger(component="http")


class HTTPFailure(Exception):
    """Raised when a request cannot be completed. Carries the snapshot path if one was written."""

    def __init__(
        self,
        message: str,
        *,
        url: str,
        status_code: int | None = None,
        snapshot_path: Path | None = None,
    ) -> None:
        super().__init__(message)
        self.url = url
        self.status_code = status_code
        self.snapshot_path = snapshot_path


class RetryableHTTPError(Exception):
    def __init__(self, response: httpx.Response, retry_after: float | None) -> None:
        super().__init__(f"HTTP {response.status_code} for {response.request.url}")
        self.response = response
        self.retry_after = retry_after


@dataclass
class FetchResult:
    url: str
    status_code: int
    text: str
    from_cache: bool
    cache_path: Path | None
    fetched_at: datetime

    def json(self) -> Any:
        return json.loads(self.text)


def write_snapshot(settings: Settings, source: str, content: str, suffix: str = ".html") -> Path:
    directory = settings.snapshot_dir(source)
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    path = directory / f"{stamp}{suffix}"
    path.write_text(content, encoding="utf-8")
    return path


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        from email.utils import parsedate_to_datetime

        when = parsedate_to_datetime(value)
        return max(0.0, (when - datetime.now(UTC)).total_seconds())
    except (TypeError, ValueError):
        return None


class PoliteClient:
    """Synchronous, single-threaded, cached, rate limited HTTP client for one source."""

    def __init__(
        self,
        source: str,
        *,
        settings: Settings | None = None,
        rate_limit_per_sec: float = 1.0,
        timeout_sec: float = 30,
        max_attempts: int = 5,
        headers: dict[str, str] | None = None,
        cache: bool = True,
        force: bool = False,
        run_date: date | None = None,
        transport: httpx.BaseTransport | None = None,
        sleep: Any = time.sleep,
    ) -> None:
        self.source = source
        self.settings = settings or get_settings()
        self.min_interval = 1.0 / rate_limit_per_sec if rate_limit_per_sec > 0 else 0.0
        self.max_attempts = max(1, max_attempts)
        self.cache_enabled = cache
        self.force = force
        self._sleep = sleep
        self._last_request_at: dict[str, float] = {}
        run_day = run_date or datetime.now(UTC).date()
        self.cache_dir = self.settings.raw_dir(source) / run_day.isoformat()
        base_headers = {"User-Agent": self.settings.user_agent, "Accept": "application/json, */*"}
        if headers:
            base_headers.update(headers)
        proxy = self.settings.proxy_url or None
        self._client = httpx.Client(
            timeout=timeout_sec,
            headers=base_headers,
            follow_redirects=True,
            transport=transport,
            proxy=proxy if transport is None else None,
        )

    # -- cache -----------------------------------------------------------------------------
    @staticmethod
    def cache_key(url: str) -> str:
        return hashlib.sha1(url.encode("utf-8")).hexdigest()[:24]

    def _cache_path(self, url: str) -> Path:
        return self.cache_dir / f"{self.cache_key(url)}.json"

    def _read_cache(self, url: str) -> FetchResult | None:
        if not self.cache_enabled or self.force:
            return None
        path = self._cache_path(url)
        if not path.exists():
            return None
        try:
            envelope = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if envelope.get("url") != url:
            return None
        return FetchResult(
            url=url,
            status_code=int(envelope.get("status_code", 200)),
            text=envelope.get("body", ""),
            from_cache=True,
            cache_path=path,
            fetched_at=datetime.fromisoformat(envelope["fetched_at"]),
        )

    def _write_cache(self, url: str, response: httpx.Response, fetched_at: datetime) -> Path | None:
        if not self.cache_enabled:
            return None
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path = self._cache_path(url)
        envelope = {
            "source": self.source,
            "url": url,
            "status_code": response.status_code,
            "content_type": response.headers.get("content-type"),
            "fetched_at": fetched_at.isoformat(),
            "body": response.text,
        }
        path.write_text(json.dumps(envelope), encoding="utf-8")
        return path

    # -- rate limit --------------------------------------------------------------------------
    def _throttle(self, url: str) -> None:
        host = urlsplit(url).netloc
        last = self._last_request_at.get(host)
        now = time.monotonic()
        if last is not None and self.min_interval > 0:
            wait = self.min_interval - (now - last)
            if wait > 0:
                self._sleep(wait)
        self._last_request_at[host] = time.monotonic()

    # -- request -----------------------------------------------------------------------------
    def _wait(self, retry_state: RetryCallState) -> float:
        outcome = retry_state.outcome
        exc = outcome.exception() if outcome is not None else None
        if isinstance(exc, RetryableHTTPError) and exc.retry_after is not None:
            return min(exc.retry_after, 120.0)
        return wait_exponential_jitter(initial=1, max=30)(retry_state)

    def _send_once(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        self._throttle(url)
        response = self._client.request(method, url, **kwargs)
        if response.status_code == 429 or response.status_code >= 500:
            raise RetryableHTTPError(
                response, _parse_retry_after(response.headers.get("retry-after"))
            )
        return response

    def request(self, method: str, url: str, **kwargs: Any) -> FetchResult:
        """Fetch a URL (cache first). Raises HTTPFailure after retries are exhausted or on 4xx."""
        cached = self._read_cache(url) if method.upper() == "GET" else None
        if cached is not None:
            return cached
        last_response: httpx.Response | None = None
        try:
            for attempt in Retrying(
                stop=stop_after_attempt(self.max_attempts),
                wait=self._wait,
                retry=retry_if_exception_type((RetryableHTTPError, httpx.TransportError)),
                sleep=self._sleep,
                reraise=True,
            ):
                with attempt:
                    try:
                        response = self._send_once(method, url, **kwargs)
                    except RetryableHTTPError as exc:
                        last_response = exc.response
                        log.warning(
                            "http.retry",
                            source=self.source,
                            status=exc.response.status_code,
                            attempt=attempt.retry_state.attempt_number,
                        )
                        raise
        except RetryableHTTPError as exc:
            snapshot = self._snapshot_response(exc.response)
            raise HTTPFailure(
                f"gave up after {self.max_attempts} attempts: HTTP {exc.response.status_code}",
                url=url,
                status_code=exc.response.status_code,
                snapshot_path=snapshot,
            ) from exc
        except httpx.TransportError as exc:
            snapshot = self._snapshot_response(last_response) if last_response else None
            raise HTTPFailure(
                f"transport error after {self.max_attempts} attempts: {exc}",
                url=url,
                snapshot_path=snapshot,
            ) from exc

        if response.status_code >= 400:
            snapshot = self._snapshot_response(response)
            raise HTTPFailure(
                f"HTTP {response.status_code}",
                url=url,
                status_code=response.status_code,
                snapshot_path=snapshot,
            )
        fetched_at = datetime.now(UTC)
        cache_path = (
            self._write_cache(url, response, fetched_at) if method.upper() == "GET" else None
        )
        return FetchResult(
            url=url,
            status_code=response.status_code,
            text=response.text,
            from_cache=False,
            cache_path=cache_path,
            fetched_at=fetched_at,
        )

    def get(self, url: str, params: dict[str, Any] | None = None) -> FetchResult:
        full_url = str(httpx.URL(url, params=params or {}))
        return self.request("GET", full_url)

    def get_json(self, url: str, params: dict[str, Any] | None = None) -> tuple[Any, FetchResult]:
        result = self.get(url, params)
        try:
            return result.json(), result
        except json.JSONDecodeError as exc:
            snapshot = write_snapshot(self.settings, self.source, result.text, ".txt")
            raise HTTPFailure(
                f"non-JSON response ({exc})", url=result.url, snapshot_path=snapshot
            ) from exc

    def _snapshot_response(self, response: httpx.Response | None) -> Path | None:
        if response is None:
            return None
        content_type = response.headers.get("content-type", "")
        suffix = ".json" if "json" in content_type else ".html"
        return write_snapshot(self.settings, self.source, response.text, suffix)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> PoliteClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
