"""structlog configuration. Console renderer on a TTY, JSON otherwise. No secrets in logs."""

from __future__ import annotations

import logging
import sys

import structlog

_configured = False


class _StderrHandler(logging.StreamHandler):
    """Writes to whatever sys.stderr is at emit time, not at configure time.

    Typer's CliRunner and pytest swap sys.stderr for a temporary stream; a handler bound to the
    original object would later raise "I/O operation on closed file".
    """

    def __init__(self) -> None:
        super().__init__(sys.stderr)

    @property
    def stream(self) -> object:
        return sys.stderr

    @stream.setter
    def stream(self, value: object) -> None:
        pass


def _stderr_logger(*args: object) -> structlog.PrintLogger:
    """structlog logger factory resolving sys.stderr per call (see _StderrHandler)."""
    return structlog.PrintLogger(file=sys.stderr)


def configure_logging(level: str = "INFO") -> None:
    global _configured
    if _configured:
        return
    logging.basicConfig(format="%(message)s", handlers=[_StderrHandler()], level=level.upper())
    renderer: structlog.types.Processor
    if sys.stderr.isatty():
        renderer = structlog.dev.ConsoleRenderer()
    else:
        renderer = structlog.processors.JSONRenderer()
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping()[level.upper()]
        ),
        logger_factory=_stderr_logger,
        cache_logger_on_first_use=False,
    )
    _configured = True


def get_logger(**initial: object) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(**initial)
