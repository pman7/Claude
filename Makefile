# Integra Dentist Outbound Engine. See CLAUDE.md section 14.
SOURCE ?= nppes
STATE ?=
LIMIT ?= 0
FORCE ?= 0
SEGMENT ?= all
STAGE ?= all
UV ?= uv

FORCE_FLAG := $(if $(filter 1 true yes,$(FORCE)),--force,)
STATE_FLAG := $(if $(STATE),--state $(STATE),)

.PHONY: setup migrate pull resolve signals score enrich verify export health diff run_all test lint fmt db-up db-down

setup:
	$(UV) python install 3.12
	$(UV) sync --group dev
	@test -f .env || cp .env.example .env
	$(UV) run playwright install chromium || echo "playwright chromium install skipped"
	$(MAKE) migrate

migrate:
	$(UV) run integra migrate

pull:
	$(UV) run integra pull $(SOURCE) $(STATE_FLAG) --limit $(LIMIT) $(FORCE_FLAG)

resolve:
	$(UV) run integra resolve

signals:
	$(UV) run integra signals

score:
	$(UV) run integra score

enrich:
	$(UV) run integra enrich --stage $(STAGE)

verify:
	$(UV) run integra verify

export:
	$(UV) run integra export $(SEGMENT)

health:
	$(UV) run integra health

diff:
	$(UV) run integra diff

run_all:
	$(UV) run integra run-all

test:
	$(UV) run pytest

lint:
	$(UV) run ruff check src tests
	$(UV) run ruff format --check src tests

fmt:
	$(UV) run ruff check --fix src tests
	$(UV) run ruff format src tests

db-up:
	docker compose up -d postgres

db-down:
	docker compose down
