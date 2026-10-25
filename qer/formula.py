"""QER scoring and NFL passer rating, vectorised over a DataFrame.

Input columns (one row per QB-game) are produced by ``qer.features``:
    cpoe, epy, dropbacks, int_cost, fumble_cost, sack_cost, credit_z, won
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .params import DEFAULT_PARAMS, QERParams


def _clip(x, lo, hi):
    return np.minimum(hi, np.maximum(lo, x))


def component_a(cpoe, p: QERParams = DEFAULT_PARAMS):
    """Accuracy: linear in CPOE (percentage points), capped."""
    return _clip(p.a_slope_eff * (np.asarray(cpoe, float) + p.a_offset), 0, p.a_max)


def component_b(epy_per_db, p: QERParams = DEFAULT_PARAMS):
    """Efficiency: concave curve on EPY per dropback between floor and ceiling."""
    t = _clip((np.asarray(epy_per_db, float) - p.b_floor) / (p.b_ceiling - p.b_floor), 0, 1)
    return p.b_max * t ** p.b_exponent


def component_c(z, p: QERParams = DEFAULT_PARAMS):
    """Scoring credit: piecewise-linear in credit per dropback (z)."""
    z = np.asarray(z, float)
    return np.where(
        z <= p.c_pivot_z,
        p.c_slope * z,
        np.where(z < p.c_ceiling_z, p.c_pivot + p.c_upper_slope * (z - p.c_pivot_z), p.c_max),
    )


def component_d(int_cost, fumble_cost, sack_cost, dropbacks, p: QERParams = DEFAULT_PARAMS):
    """Ball security: falls linearly as weighted EPA lost per dropback rises."""
    cost = (p.d_w_int * np.asarray(int_cost, float)
            + p.d_w_fumble * np.asarray(fumble_cost, float)
            + p.d_w_sack * np.asarray(sack_cost, float)) / np.asarray(dropbacks, float)
    return _clip(p.d_start_eff * (1 - _clip(cost / p.d_zero_cost, 0, 1)), 0, p.d_max)


def win_bonus(raw, won, p: QERParams = DEFAULT_PARAMS):
    raw = np.asarray(raw, float)
    idx = np.searchsorted(np.asarray(p.bonus_bands), raw, side="left")  # raw <= band -> that band
    bonus = np.asarray(p.bonus_values)[idx]
    return np.where(np.asarray(won, bool), bonus, 0.0)


def score(df: pd.DataFrame, p: QERParams = DEFAULT_PARAMS) -> pd.DataFrame:
    """Return df with qer_a..qer_d, qer_raw, qer_bonus and qer columns added."""
    p.validate()
    out = df.copy()
    out["qer_a"] = component_a(out["cpoe"].fillna(-p.a_offset), p)  # no CPOE -> A = 0
    out["qer_b"] = component_b(out["epy"] / out["dropbacks"], p)
    out["qer_c"] = component_c(out["credit_z"], p)
    out["qer_d"] = component_d(out["int_cost"], out["fumble_cost"], out["sack_cost"], out["dropbacks"], p)
    out["qer_raw"] = (p.w_a * out.qer_a / p.a_max + p.w_b * out.qer_b / p.b_max
                      + p.w_c * out.qer_c / p.c_max + p.w_d * out.qer_d / p.d_max)
    out["qer_bonus"] = win_bonus(out["qer_raw"], out["won"], p)
    # Excel ROUND is half-away-from-zero; QER is never negative, so floor(x*10+0.5) matches it
    out["qer"] = np.floor(np.minimum(p.final_cap, out.qer_raw + out.qer_bonus) * 10 + 0.5 + 1e-9) / 10
    return out


def passer_rating(comp, att, yds, td, ints):
    """Traditional NFL passer rating (0 to 158.3)."""
    comp, att, yds, td, ints = (np.asarray(x, float) for x in (comp, att, yds, td, ints))
    with np.errstate(divide="ignore", invalid="ignore"):
        a = _clip((comp / att - 0.3) * 5, 0, 2.375)
        b = _clip((yds / att - 3) * 0.25, 0, 2.375)
        c = _clip(td / att * 20, 0, 2.375)
        d = _clip(2.375 - ints / att * 25, 0, 2.375)
        pr = (a + b + c + d) / 6 * 100
    return np.where(att > 0, np.floor(pr * 10 + 0.5 + 1e-9) / 10, np.nan)  # Excel-style rounding
