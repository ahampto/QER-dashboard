"""Estimate QER during a game from the live box score (and ESPN's live QBR when it exists).

Real QER needs EPA and CPOE, which nflverse computes overnight. During a game, ESPN's
live feed only has the box score, so the site shows an *estimate*: linear models
fitted on every start since 2006 that predict QER from per-dropback rates.

Two models are fitted:

    box   box-score rates + passer rating (always available live)
    qbr   the same + ESPN QBR (QBR is built on EPA, so it carries information the box
          score lacks; used only when ESPN publishes a real live QBR)

Rates (not totals) are used so a QB halfway through a game isn't penalized for having
fewer yards so far. Backtest (fit on 2006-2019, test on 2020+ starts):

    model                                     mean miss   within 10 pts
    old box score model                         6.95          76%
    passer rating alone                         8.77          64%
    QBR alone                                   9.84          58%
    box (box score + passer rating + extras)    6.61          78%
    qbr (box + QBR)                             6.29          80%

Passer rating alone and QBR alone are each worse than the box score: passer rating is
just a fixed formula of the same box-score numbers, and QBR mixes in things QER leaves
out (YAC, clutch weighting). Combined with the box score, QBR does add real information.

The coefficients are written to site/data/live_model.json by qer.export, and
site/app.js applies them to the live box score.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

BOX_FEATURES = ["comp_pct", "ypa", "td_rate", "int_rate", "sack_rate", "sack_yds_db",
                "rush_yds_db", "rush_td_db", "margin", "lead",
                "passer_rating", "ypa_sq", "comp_pct_sq", "fum_lost_db", "rush_att_db"]
QBR_FEATURES = BOX_FEATURES + ["qbr"]
FEATURES = BOX_FEATURES   # kept for older imports


def passer_rating(comp, att, yds, td, ints):
    """NFL passer rating, 0 to 158.3."""
    def c(v):
        return np.clip(v, 0, 2.375)
    return (c((comp / att - 0.3) * 5) + c((yds / att - 3) * 0.25)
            + c(td / att * 20) + c(2.375 - ints / att * 25)) / 6 * 100


def features(d: pd.DataFrame) -> pd.DataFrame:
    """Per-dropback rates from box-score columns: comp, att, yds, td, ints, sacks,
    sack_yds, rush_att, rush_yds, rush_td, fumbles_lost, the current score pf/pa, and
    qbr if present. Passer rating is recomputed from the box score so it matches live."""
    db = d.att + d.sacks
    ypa = (d.yds / d.att).clip(-5, 20)

    def col(name):
        return d[name] if name in d else 0
    return pd.DataFrame({
        "comp_pct": d.comp / d.att, "ypa": ypa,
        "td_rate": d.td / db, "int_rate": d.ints / db,
        "sack_rate": d.sacks / db, "sack_yds_db": d.sack_yds / db,
        "rush_yds_db": d.rush_yds / db, "rush_td_db": d.rush_td / db,
        "margin": (d.pf - d.pa).clip(-28, 28), "lead": ((d.pf - d.pa) > 0).astype(float),
        "passer_rating": passer_rating(d.comp, d.att, d.yds, d.td, d.ints),
        "ypa_sq": ypa.clip(0, 15) ** 2, "comp_pct_sq": (d.comp / d.att) ** 2,
        "fum_lost_db": col("fumbles_lost") / db, "rush_att_db": col("rush_att") / db,
        "qbr": col("qbr"),
    }, index=d.index)


def _ols(X: pd.DataFrame, y: pd.Series, cols: list[str]) -> dict:
    """Ordinary least squares with NumPy (no extra library needed)."""
    A = np.column_stack([np.ones(len(X)), X[cols].to_numpy(float)])
    coef, *_ = np.linalg.lstsq(A, y.to_numpy(float), rcond=None)
    resid = y.to_numpy(float) - np.clip(A @ coef, 0, 100)
    return {"intercept": round(float(coef[0]), 5),
            "coef": {f: round(float(c), 5) for f, c in zip(cols, coef[1:])},
            "mae": round(float(np.abs(resid).mean()), 2), "n_games": int(len(X))}


def fit(qb_games: pd.DataFrame, min_dropbacks: int = 14) -> dict:
    g = qb_games[(qb_games.dropbacks >= min_dropbacks) & (qb_games.att > 0)]
    X = features(g)
    box = _ols(X, g.qer, BOX_FEATURES)
    has = g.qbr.notna() if "qbr" in g else pd.Series(False, index=g.index)
    qbr = _ols(X[has], g.qer[has], QBR_FEATURES) if has.sum() > 50 else None
    # top level = box model, so older site code keeps working
    return {**box, "min_dropbacks": 10, "qbr_model": qbr}


def predict(model: dict, d: pd.DataFrame) -> pd.Series:
    """Uses the QBR model for rows with a QBR, the box model otherwise."""
    X = features(d)

    def lin(m):
        return m["intercept"] + sum(c * X[f] for f, c in m["coef"].items())
    est = lin(model)
    q = model.get("qbr_model")
    if q and "qbr" in d:
        est = est.where(d.qbr.isna(), lin(q))
    return est.clip(0, 100)
