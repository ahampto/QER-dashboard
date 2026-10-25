"""End-to-end: ingest into a throwaway SQLite DB, compute, read back."""
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

from qer import db
from qer.pipeline import compute, ingest

PLAYS = pd.read_parquet(Path(__file__).parent / "fixtures" / "plays_sample.parquet")
SEASON = 2026


def fake_loaders():
    plays = PLAYS[PLAYS.season == SEASON]
    games = plays.drop_duplicates("game_id")[["game_id", "season", "week", "home_team", "away_team",
                                               "home_score", "away_score"]]
    qbr = pd.DataFrame([{"season": SEASON, "week": 2, "team": "LA", "name_last": "Stafford",
                         "name_display": "Matthew Stafford", "qbr": 77.0, "headshot_href": None}])
    return SimpleNamespace(load_pbp=lambda s: plays, load_schedule=lambda ss: games,
                           load_qbr=lambda ss: qbr)


@pytest.fixture()
def engine(tmp_path):
    eng = db.get_engine(f"sqlite:///{tmp_path / 'test.db'}")
    ingest(eng, [SEASON], loaders=fake_loaders())
    compute(eng, [SEASON])
    return eng


def test_tables_filled(engine):
    for t in ["plays", "games", "qbr_weekly", "qb_games", "qb_drives", "power_ratings"]:
        assert db.read_sql(engine, f"SELECT COUNT(*) AS n FROM {t}").n.iat[0] > 0, t


def test_qer_read_back_from_db(engine):
    row = db.read_sql(engine, "SELECT * FROM qb_games WHERE qb_name = 'M.Stafford'").iloc[0]
    assert row.passer_rating == 134.3                       # workbook value
    assert row.qer >= 74.8                                  # v2.3 can only raise A and D vs v2.2
    assert row.qbr == 77.0 and row.display_name == "Matthew Stafford"


def test_rerun_is_idempotent(engine):
    before = db.read_sql(engine, "SELECT COUNT(*) AS n FROM qb_games").n.iat[0]
    compute(engine, [SEASON])
    ingest(engine, [SEASON], loaders=fake_loaders())
    after = db.read_sql(engine, "SELECT COUNT(*) AS n FROM qb_games").n.iat[0]
    assert before == after


def test_power_ratings_ranked_and_shrunk(engine):
    pr = db.read_sql(engine, "SELECT * FROM power_ratings")
    week1 = pr[pr.week == pr.week.min()]
    assert week1.power_rank.dropna().min() == 1        # week 1: one game is enough to rank
    last = pr[pr.week == pr.week.max()]
    assert last.power_rank.isna().all()                # later: one game is only provisional
    # no 2025 data in this test DB, so every QB starts from the league average
    assert (last.prior_source == "league average").all()
    assert ((last.power - last.prior).abs() <= (last.form_qer - last.prior).abs() + 1e-9).all()


def test_prior_comes_from_own_last_season():
    from qer.power import PowerParams, power_ratings
    base = dict(team="X", opp="Y", result="W", won=True, total_epa=5.0, comp=20, att=30, yds=250,
                td=2, ints=0, qbr=None, qb_name="Q", display_name="Q", headshot_href=None)
    prev = pd.DataFrame([dict(base, season=2025, week=w, game_id=f"p{w}", qb_id=q, qer=v, dropbacks=35)
                         for w in range(1, 18) for q, v in [("good", 70.0), ("avg", 45.0)]])
    cur = pd.DataFrame([dict(base, season=2026, week=1, game_id=f"c{q}", qb_id=q, qer=50.0, dropbacks=35)
                        for q in ["good", "avg", "rookie"]])
    pr = power_ratings(cur, PowerParams(), prev_games=prev).set_index("qb_id")
    assert pr.loc["good", "prior_source"] == "last season"
    assert pr.loc["rookie", "prior_source"] == "league average"
    assert pr.loc["good", "power"] > pr.loc["avg", "power"]     # same week-1 game, better history
