"""All Playwright interaction with the Hawaii DCCA MyPVL public license search.

The page is a JavaScript app whose exact DOM is UNKNOWN until Phillip's first live run
captures it (see tests/fixtures/hi_dcca/mypvl_search_page_notes.md). Every selector therefore
lives in its own small method with several role / label / text fallbacks, so a repair after
the first capture is a one-method change. Nothing here is exercised in tests: the adapter
takes a `browser_factory` and the tests inject a fake that implements LicenseSearchBrowser.

Politeness (hard rules 1 and 3) is split between this module and the adapter: this module
runs exactly one page, never retries through a challenge, and identifies itself with the
configured User-Agent; the adapter sleeps between submissions and caches every result.
"""

from __future__ import annotations

import contextlib
import re
import time
from collections.abc import Sequence
from typing import Any, Protocol
from urllib.parse import urljoin

from playwright.sync_api import Browser, BrowserContext, Locator, Page, Playwright, sync_playwright
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from integra.sources.hi_dcca_parse import looks_like_challenge

LICENSE_NUMBER_TAB = re.compile(r"license\s*number", re.I)
LICENSE_INPUT_LABEL = re.compile(r"license\s*(number|no\.?|#)", re.I)
LICENSE_INPUT_PLACEHOLDER = re.compile(r"ACU-|license", re.I)
SUBMIT_BUTTON = re.compile(r"^\s*(submit|search)\s*$", re.I)
RESULTS_TABLE_TEXT = re.compile(r"license\s*type", re.I)
NO_RESULTS_TEXT = re.compile(r"no (records|results|licenses?)|not found", re.I)
POLL_MS = 250
SAME_RESULT_GRACE_SEC = 1.5


class BrowserPageError(Exception):
    """A page state the adapter must snapshot. Carries the HTML that was on screen."""

    def __init__(self, message: str, *, html: str) -> None:
        super().__init__(message)
        self.html = html


class ChallengeDetected(BrowserPageError):
    """CAPTCHA / Cloudflare challenge / access denied. Never retried (hard rule 1)."""


class ResultsTimeout(BrowserPageError):
    """The expected element (form, table or no-results message) never appeared."""


class LicenseSearchBrowser(Protocol):
    """What the adapter needs from a browser. Tests pass a fake with these four methods."""

    def open(self) -> None: ...

    def close(self) -> None: ...

    def search_license_numbers(self, numbers: Sequence[str]) -> str: ...

    def open_detail(self, row: dict[str, Any]) -> str | None: ...


class MyPvlBrowser:
    """One headless Chromium page driving the MyPVL 'License Number' search tab."""

    def __init__(
        self,
        base_url: str,
        *,
        user_agent: str,
        proxy_url: str | None = None,
        headless: bool = True,
        timeout_sec: float = 30.0,
    ) -> None:
        self.base_url = base_url
        self.user_agent = user_agent
        self.proxy_url = proxy_url
        self.headless = headless
        self.timeout_sec = timeout_sec
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

    # -- lifecycle ---------------------------------------------------------------------------------
    def open(self) -> None:
        self._playwright = sync_playwright().start()
        launch: dict[str, Any] = {"headless": self.headless}
        if self.proxy_url:
            launch["proxy"] = {"server": self.proxy_url}
        self._browser = self._playwright.chromium.launch(**launch)
        self._context = self._browser.new_context(user_agent=self.user_agent)
        self._page = self._context.new_page()
        self._page.set_default_timeout(self.timeout_sec * 1000)
        self._page.goto(self.base_url, wait_until="domcontentloaded")
        self._settle()
        self._raise_if_challenge("open")
        self._show_license_number_form()

    def close(self) -> None:
        for closer in (
            self._context.close if self._context else None,
            self._browser.close if self._browser else None,
            self._playwright.stop if self._playwright else None,
        ):
            if closer is not None:
                with contextlib.suppress(PlaywrightError):
                    closer()
        self._page = self._context = self._browser = self._playwright = None

    @property
    def page(self) -> Page:
        if self._page is None:
            raise RuntimeError("MyPvlBrowser.open() must be called first")
        return self._page

    # -- public actions ------------------------------------------------------------------------
    def search_license_numbers(self, numbers: Sequence[str]) -> str:
        """Submit one comma-separated batch and return the page HTML once results rendered."""
        self._show_license_number_form()
        box = self._license_input()
        box.fill(",".join(numbers))
        before = self._results_signature()
        self._submit_button().click()
        self._settle()
        self._wait_for_results(before, numbers)
        return self.page.content()

    def open_detail(self, row: dict[str, Any]) -> str | None:
        """Follow the row's detail link if it has one, return its HTML, then come back."""
        href = row.get("detail_href")
        if not href:
            return None
        self.page.goto(urljoin(self.base_url, str(href)), wait_until="domcontentloaded")
        self._settle()
        self._raise_if_challenge("detail")
        html = self.page.content()
        self._return_to_search()
        return html

    # -- challenge detection -------------------------------------------------------------------
    @staticmethod
    def challenge_marker(html: str) -> str | None:
        return looks_like_challenge(html)

    def _raise_if_challenge(self, phase: str) -> None:
        html = self.page.content()
        marker = self.challenge_marker(html)
        if marker:
            raise ChallengeDetected(f"challenge marker {marker!r} during {phase}", html=html)

    # -- selectors: one method each so a DOM change is a local repair ------------------------
    def _license_number_tab(self) -> Locator | None:
        page = self.page
        return self._first_present(
            [
                page.get_by_role("tab", name=LICENSE_NUMBER_TAB),
                page.get_by_role("link", name=LICENSE_NUMBER_TAB),
                page.get_by_role("button", name=LICENSE_NUMBER_TAB),
                page.get_by_text(LICENSE_NUMBER_TAB),
            ]
        )

    def _license_input_candidates(self) -> list[Locator]:
        page = self.page
        return [
            page.get_by_label(LICENSE_INPUT_LABEL),
            page.get_by_placeholder(LICENSE_INPUT_PLACEHOLDER),
            page.locator("textarea:visible"),
            page.locator("input[type='text']:visible, input:not([type]):visible"),
        ]

    def _license_input(self) -> Locator:
        box = self._first_present(self._license_input_candidates(), wait=True)
        if box is None:
            raise ResultsTimeout("license number input not found", html=self.page.content())
        return box

    def _submit_button(self) -> Locator:
        page = self.page
        button = self._first_present(
            [
                page.get_by_role("button", name=SUBMIT_BUTTON),
                page.locator("button[type='submit']:visible"),
                page.locator("input[type='submit']:visible"),
            ],
            wait=True,
        )
        if button is None:
            raise ResultsTimeout("submit button not found", html=self.page.content())
        return button

    def _results_table(self) -> Locator:
        return self.page.locator("table").filter(has_text=RESULTS_TABLE_TEXT)

    def _no_results_message(self) -> Locator:
        return self.page.get_by_text(NO_RESULTS_TEXT)

    # -- waits ------------------------------------------------------------------------------------
    def _settle(self) -> None:
        # A long-polling script can keep the network busy forever; the result polls below cope.
        with contextlib.suppress(PlaywrightTimeoutError):
            self.page.wait_for_load_state("networkidle", timeout=self.timeout_sec * 1000)

    def _results_signature(self) -> str | None:
        """Text of what is currently shown as a result, so a new submission can be told apart."""
        try:
            table = self._results_table()
            if table.count():
                return "table:" + table.first.inner_text()
            message = self._no_results_message()
            if message.count():
                return "message:" + message.first.inner_text()
        except PlaywrightError:
            return None
        return None

    def _wait_for_results(self, before: str | None, expected: Sequence[str] = ()) -> None:
        started = time.monotonic()
        deadline = started + self.timeout_sec
        while time.monotonic() < deadline:
            signature = self._results_signature()
            if signature is not None:
                if signature != before:
                    return
                grace_over = time.monotonic() - started >= SAME_RESULT_GRACE_SEC
                if grace_over and self._signature_shows(signature, expected):
                    return
            self._raise_if_challenge("results")
            self.page.wait_for_timeout(POLL_MS)
        raise ResultsTimeout(
            "results did not update for this batch (no table showing the submitted numbers"
            " and no no-results message)",
            html=self.page.content(),
        )

    @staticmethod
    def _signature_shows(signature: str, expected: Sequence[str]) -> bool:
        """An unchanged result area is only accepted when it shows this batch's numbers (or a
        no-results message), so a slow page can never be cached under the next batch's name."""
        if not expected or signature.startswith("message:"):
            return True
        wanted = {re.sub(r"\D", "", n).lstrip("0") for n in expected}
        shown = {digits.lstrip("0") for digits in re.findall(r"\d+", signature)}
        return any(w and w in shown for w in wanted)

    def _first_present(self, candidates: list[Locator], *, wait: bool = False) -> Locator | None:
        deadline = time.monotonic() + (self.timeout_sec if wait else 0)
        while True:
            for candidate in candidates:
                try:
                    if candidate.count() > 0:
                        return candidate.first
                except PlaywrightError:
                    continue
            if time.monotonic() >= deadline:
                return None
            self.page.wait_for_timeout(POLL_MS)

    def _show_license_number_form(self) -> None:
        if self._first_present(self._license_input_candidates()) is not None:
            return  # the License Number tab is already active
        tab = self._license_number_tab()
        if tab is not None:
            tab.click()
            self._settle()

    def _return_to_search(self) -> None:
        try:
            self.page.go_back(wait_until="domcontentloaded")
        except PlaywrightError:
            self.page.goto(self.base_url, wait_until="domcontentloaded")
        self._settle()
        self._raise_if_challenge("return")
        self._show_license_number_form()
