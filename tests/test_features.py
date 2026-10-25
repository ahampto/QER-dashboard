"""Play-by-play -> QER inputs, checked against workbook games.

The fixture holds every play from 10 games chosen to cover the edge cases:
spikes (2006 DEN-KC), two-point tries (2006 IND-DEN), intentional grounding
(2017 LA-SEA), a backup QB taking sacks (2023 CLE-DEN), plus 2026 games.
"""
from pathlib import Path

import pandas as pd
import pytest

from qer.features import qb_game_features
from qer.formula import score
from qer.params import QERParams

FIX = Path(__file__).parent / "fixtures"
PLAYS = pd.read_parquet(FIX / "plays_sample.parquet")
WB = pd.read_csv(FIX / "workbook_qer_v2_2.csv")
WB[["game_id", "qb_name"]] = WB.key.str.split("|", expand=True)


WORKBOOK_RULES = QERParams.v2_2()   # original workbook conventions


def _merge(params):
    feats = score(qb_game_features(PLAYS, params), params)
    return WB.merge(feats, on=["game_id", "qb_name"], suffixes=("_wb", ""))


@pytest.fixture(scope="module")
def merged():
    """Scored with the workbook's grounding rule, to compare like with like."""
    return _merge(WORKBOOK_RULES)


def test_all_fixture_games_found(merged):
    expected = WB[WB.game_id.isin(PLAYS.game_id.unique())]
    assert len(merged) == len(expected) == 11   # Romo and P.Manning share one game


@pytest.mark.parametrize("col", ["comp", "att", "yds", "td", "ints"])
def test_box_score(merged, col):
    assert (merged[f"{col}_wb"] == merged[col]).all()


@pytest.mark.parametrize("col", ["epy", "cpoe", "int_cost", "fumble_cost"])
def test_qer_inputs(merged, col):
    pd.testing.assert_series_equal(merged[f"{col}_wb"], merged[col], check_names=False, atol=1e-6)


def test_qer_matches_workbook_where_sacks_are_the_starters(merged):
    same = merged[merged.sacks_wb == merged.sacks]
    assert len(same) == len(merged) - 1
    assert (same.qer_wb == same.qer).all(), same.loc[same.qer_wb != same.qer, ["key", "qer_wb", "qer"]]


def test_backup_sacks_are_not_charged_to_starter(merged):
    """Workbook charged P.Walker's 4 sacks to D.Thompson-Robinson; we don't."""
    row = merged[merged.key == "2023_12_CLE_DEN|D.Thompson-Robinson"].iloc[0]
    assert row.sacks_wb == 4 and row.sacks == 0
    assert row.dropbacks == row.att + row.sacks + row.groundings


def test_grounding_counted_once_by_default():
    """R.Wilson 2017 Wk15: 30 attempts (1 is a grounding) + 7 sacks = 37 dropbacks."""
    default = _merge(QERParams())
    row = default[default.key == "2017_15_LA_SEA|R.Wilson"].iloc[0]
    assert row.groundings == 1 and row.att == 30 and row.sacks == 7
    assert row.dropbacks == 37            # workbook had 38 (grounding counted twice)


def test_workbook_rule_counts_grounding_twice(merged):
    row = merged[merged.key == "2017_15_LA_SEA|R.Wilson"].iloc[0]
    assert row.dropbacks == row.dropbacks_wb == 38


def test_one_row_per_qb_game():
    feats = qb_game_features(PLAYS)
    assert not feats.duplicated(["game_id", "qb_id"]).any()
    assert set(feats.result) <= {"W", "L", "T"}


def _with_extra_play(**kw):
    """The fixture plus one extra fumble play in Stafford's 2026 Wk2 game."""
    base = PLAYS[(PLAYS.game_id == "2026_02_NYG_LA") & (PLAYS.passer_player_name == "M.Stafford")].iloc[[0]].copy()
    fields = dict(play_id=999999, pass_attempt=0, complete_pass=0, sack=0, interception=0, rush_attempt=0,
                  passer_player_id=None, passer_player_name=None, fixed_drive_result="Punt",
                  fumble=1, fumble_lost=0, fumbled_2_player_id=None, aborted_play=1)
    base = base.assign(**(fields | kw))
    plays = pd.concat([PLAYS, base], ignore_index=True)
    row = lambda pl: qb_game_features(pl).set_index("qb_name").loc["M.Stafford"]  # noqa: E731
    return row(PLAYS), row(plays)


def test_center_charged_snap_fumble_does_not_count():
    """Scorer charges the center (like 2024's 'C.Rush Aborted. 56-C.Beebe FUMBLES'): QB untouched."""
    before, after = _with_extra_play(fumbled_1_player_id="00-CENTER", fumble_lost=1, epa=-4.0)
    assert after.fumbles == before.fumbles and after.fumble_cost == before.fumble_cost


def test_recovered_qb_fumble_costs_expected_cost():
    p = QERParams()
    qb = PLAYS[PLAYS.passer_player_name == "M.Stafford"].passer_player_id.iat[0]
    before, after = _with_extra_play(fumbled_1_player_id=qb, fumble_lost=0, epa=-1.0)
    assert after.fumbles == before.fumbles + 1
    assert after.fumble_cost == pytest.approx(before.fumble_cost + p.fumble_expected_cost)


def test_lost_qb_fumble_costs_more_than_recovered():
    qb = PLAYS[PLAYS.passer_player_name == "M.Stafford"].passer_player_id.iat[0]
    _, rec = _with_extra_play(fumbled_1_player_id=qb, fumble_lost=0, epa=-1.0)
    _, lost = _with_extra_play(fumbled_1_player_id=qb, fumble_lost=1, epa=-5.0)
    assert lost.fumble_cost - rec.fumble_cost == pytest.approx(0.5 * 5.0)
