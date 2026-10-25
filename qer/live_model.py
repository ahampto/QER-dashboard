"""Estimate QER during a game from the live box score.

Real QER needs EPA and CPOE, which nflverse computes overnight. During a game, ESPN's
live feed only has the box score, so the site shows an *estimate*: a linear model
fitted on every start since 2006 that predicts QER from per-dropback rates.

Rates (not totals) are used so a QB halfway through a game isn't penalized for
having fewer yards so far. Tested on 2020+ starts after fitting on 2006-2019, it
misses the final QER by about 7 points on average and is within 10 points 75% of
the time.

The fitted coefficients are written to site/data/live_model.json by qer.export, and
site/app.js applies them to the live box score.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

FEATURES = ["comp_pct", "ypa", "td_rate", "int_rate", "sack_rate", "sack_yds_db",
            "rush_yds_db", "rush_td_db", "margin", "lead"]


def features(d: pd.DataFrame) -> pd.DataFrame:
    """Per-dropback rates from box-score columns: comp, att, yds, td, ints, sacks,
    sack_yds, rush_yds, rush_td, and the current score pf/pa."""
    db = d.att + d.sacks
    return pd.DataFrame({
        "comp_pct": d.comp / d.att, "ypa": d.yds / d.att,
        "td_rate": d.td / db, "int_rate": d.ints / db,
        "sack_rate": d.sacks / db, "sack_yds_db": d.sack_yds / db,
        "rush_yds_db": d.rush_yds / db, "rush_td_db": d.rush_td / db,
        "margin": (d.pf - d.pa).clip(-28, 28), "lead": ((d.pf - d.pa) > 0).astype(float),
    })


def fit(qb_games: pd.DataFrame, min_dropbacks: int = 14) -> dict:
    """Ordinary least squares with NumPy (no extra library needed)."""
    g = qb_games[(qb_games.dropbacks >= min_dropbacks) & (qb_games.att > 0)]
    X = features(g)
    A = np.column_stack([np.ones(len(X)), X.to_numpy(float)])
    coef, *_ = np.linalg.lstsq(A, g.qer.to_numpy(float), rcond=None)
    resid = g.qer.to_numpy(float) - A @ coef
    return {"intercept": round(float(coef[0]), 4),
            "coef": {f: round(float(c), 4) for f, c in zip(FEATURES, coef[1:])},
            "mae": round(float(np.abs(resid).mean()), 2), "n_games": int(len(g)),
            "min_dropbacks": 10}


def predict(model: dict, d: pd.DataFrame) -> pd.Series:
    X = features(d)
    est = model["intercept"] + sum(model["coef"][f] * X[f] for f in FEATURES)
    return est.clip(0, 100)
