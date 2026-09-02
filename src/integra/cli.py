"""Command line entry points. `make <target>` wraps these. Every command ends with a summary."""

from __future__ import annotations

import time
from typing import Annotated

import typer

from integra.config import get_settings
from integra.logging import configure_logging

app = typer.Typer(
    no_args_is_help=True, add_completion=False, help="Integra Dentist Outbound Engine"
)

NOT_YET = "not implemented yet (later phase). See CLAUDE.md section 17."


@app.callback()
def _main() -> None:
    configure_logging(get_settings().log_level)


@app.command()
def migrate() -> None:
    """Apply database migrations."""
    from integra.db.migrate import upgrade_head

    start = time.monotonic()
    head = upgrade_head()
    typer.echo(f"migrate: database at head {head}. Elapsed {time.monotonic() - start:.1f}s.")


@app.command()
def pull(
    source: Annotated[str, typer.Argument(help="nppes, wa_doh, hi_dcca")],
    state: Annotated[str | None, typer.Option(help="WA or HI; default all configured")] = None,
    limit: Annotated[int, typer.Option(help="stop after N raw records (0 = no limit)")] = 0,
    force: Annotated[bool, typer.Option(help="ignore today's raw cache")] = False,
) -> None:
    """Fetch, normalize and upsert one source."""
    from integra.sources import get_adapter

    try:
        adapter = get_adapter(source, force=force)
    except KeyError as exc:
        typer.echo(f"pull: {exc.args[0]}", err=True)
        raise typer.Exit(code=2) from exc
    stats = adapter.run(state=state.upper() if state else None, limit=limit or None)
    typer.echo(stats.summary())
    if stats.status == "error":
        raise typer.Exit(code=1)


@app.command()
def resolve() -> None:
    """Resolve providers and organizations into practices; derive specialty; match licenses."""
    from integra.resolve.practices import run_resolve

    stats = run_resolve()
    typer.echo(stats.summary())


@app.command("run-all")
def run_all() -> None:
    """Run every enabled adapter in order, then resolve. One failure never aborts the run."""
    from integra.config import source_config
    from integra.sources import ADAPTERS, get_adapter

    start = time.monotonic()
    lines: list[str] = []
    failures = 0
    for name in ADAPTERS:
        if not source_config(name).enabled:
            lines.append(f"{name}: disabled in config/sources.yaml.")
            continue
        try:
            stats = get_adapter(name).run()
            lines.append(stats.summary())
            failures += stats.status == "error"
        except Exception as exc:  # noqa: BLE001
            failures += 1
            lines.append(f"{name}: crashed outside the adapter: {type(exc).__name__}: {exc}")
    try:
        from integra.resolve.practices import run_resolve

        lines.append(run_resolve().summary())
    except Exception as exc:  # noqa: BLE001
        failures += 1
        lines.append(f"resolve: failed: {type(exc).__name__}: {exc}")
    for line in lines:
        typer.echo(line)
    typer.echo(
        f"run_all: {len(lines)} steps, {failures} failed. Elapsed {time.monotonic() - start:.1f}s."
    )
    if failures:
        raise typer.Exit(code=1)


def _later(name: str) -> None:
    typer.echo(f"{name}: {NOT_YET}")
    raise typer.Exit(code=2)


@app.command()
def signals() -> None:
    """Tag practice signals (phase 2)."""
    _later("signals")


@app.command()
def score() -> None:
    """ICP scoring (phase 2)."""
    _later("score")


@app.command()
def enrich(stage: str = "all") -> None:
    """Email waterfall (phase 3)."""
    _later("enrich")


@app.command()
def verify() -> None:
    """Email verification (phase 3)."""
    _later("verify")


@app.command()
def export(segment: str = "all") -> None:
    """CSV / Instantly export (phase 3)."""
    _later("export")


@app.command()
def health() -> None:
    """Healthcheck and REPAIR_NEEDED.md (phase 4)."""
    _later("health")


@app.command()
def diff() -> None:
    """Weekly trigger diff (phase 4)."""
    _later("diff")


if __name__ == "__main__":
    app()
