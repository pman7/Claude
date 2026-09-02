from sqlalchemy import select, text

from integra.db.models import Provider
from integra.db.upsert import upsert_rows

COMPARE = ["first_name", "last_name", "practice_state", "taxonomy_codes", "source_json"]


def _rows():
    return [
        {
            "npi": "1245799642",
            "first_name": "DANA",
            "last_name": "ADACHI",
            "practice_state": "HI",
            "taxonomy_codes": ["390200000X", "1223G0001X"],
            "source_json": {"number": "1245799642"},
        },
        {
            "npi": "1609082221",
            "first_name": "GERALD",
            "last_name": "ADACHI",
            "practice_state": "HI",
            "taxonomy_codes": ["1223G0001X"],
            "source_json": {"number": "1609082221"},
        },
    ]


def test_upsert_is_idempotent_and_tracks_changes(session_factory):
    with session_factory() as session:
        counts = upsert_rows(
            session, Provider.__table__, _rows(), conflict_columns=["npi"], compare_columns=COMPARE
        )
        session.commit()
    assert (counts.inserted, counts.updated, counts.unchanged) == (2, 0, 0)

    with session_factory() as session:
        session.execute(text("UPDATE providers SET last_seen = now() - interval '1 day'"))
        session.execute(text("UPDATE providers SET updated_at = now() - interval '1 day'"))
        session.commit()

    with session_factory() as session:
        counts = upsert_rows(
            session, Provider.__table__, _rows(), conflict_columns=["npi"], compare_columns=COMPARE
        )
        session.commit()
    assert (counts.inserted, counts.updated, counts.unchanged) == (0, 0, 2)

    with session_factory() as session:
        rows = session.execute(select(Provider).order_by(Provider.npi)).scalars().all()
        for row in rows:
            assert row.last_seen > row.updated_at  # last_seen moved, updated_at did not
            assert row.first_seen < row.last_seen

    changed = _rows()
    changed[0]["first_name"] = "DANA K"
    with session_factory() as session:
        counts = upsert_rows(
            session, Provider.__table__, changed, conflict_columns=["npi"], compare_columns=COMPARE
        )
        session.commit()
    assert (counts.inserted, counts.updated, counts.unchanged) == (0, 1, 1)
    with session_factory() as session:
        row = session.get(Provider, "1245799642")
        assert row.first_name == "DANA K"
        assert row.updated_at == row.last_seen
