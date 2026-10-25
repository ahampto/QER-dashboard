"""QER scoring must reproduce the QER v2.2 workbook exactly."""
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from qer.formula import component_a, component_c, component_d, passer_rating, score
from qer.params import QERParams

WB = pd.read_csv(Path(__file__).parent / "fixtures" / "workbook_qer_v2_2.csv")


V22 = QERParams.v2_2()


def test_reproduces_all_140_workbook_games():
    scored = score(WB.assign(won=WB.result.str.startswith("W")), V22)
    mismatches = WB.loc[scored.qer != WB.qer, "key"].tolist()
    assert not mismatches, f"QER differs for {mismatches}"


def test_passer_rating_matches_workbook():
    pr = passer_rating(WB.comp, WB.att, WB.yds, WB.td, WB.ints)
    np.testing.assert_allclose(pr, WB.passer_rating, atol=1e-9)


def test_perfect_passer_rating():
    assert passer_rating([20], [20], [400], [5], [0])[0] == 158.3


def test_c_curve_is_continuous_and_capped():
    p = QERParams()
    eps = 1e-9
    assert component_c(p.c_pivot_z - eps, p) == pytest.approx(component_c(p.c_pivot_z + eps, p), abs=1e-6)
    assert component_c(p.c_ceiling_z, p) == p.c_max
    assert component_c(5.0, p) == p.c_max


def test_qer_capped_at_100():
    row = pd.DataFrame([dict(cpoe=40, epy=500, dropbacks=40, int_cost=0, fumble_cost=0,
                             sack_cost=0, credit_z=3, won=True)])
    assert score(row).qer.iat[0] == 100


def test_v23_components_can_reach_their_max():
    p = QERParams()
    assert component_a(10.0, p) == p.a_max                       # CPOE +10 earns full A
    assert component_d(0, 0, 0, 30, p) == p.d_max                 # clean game earns full D
    assert component_a(10.0, V22) == 1.5 and component_d(0, 0, 0, 30, V22) == 1.5


def test_weights_must_sum_to_100():
    with pytest.raises(ValueError):
        score(WB.head(1).assign(won=True), QERParams(w_a=30))
