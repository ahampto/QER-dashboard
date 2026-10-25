"""QER Power Rating: a season-to-date QB rating built only on game QER.

For a QB through week W:

    form   = sum_g(w_g * db_g * QER_g) / sum_g(w_g * db_g)      his QER so far
    power  = (n * form + k * prior) / (n + k)                    blend with a starting point

    db_g   = dropbacks in game g          bigger games count more
    w_g    = decay ** (W - week_g)         recency weight (decay = 1.0: all games equal)
    n      = his dropbacks this season    how much evidence we have
    k      = prior strength, in dropbacks
    prior  = his own last-season QER, itself blended with that season's league average
             by his last-season dropbacks:  (n_prev * QER_prev + m * league_prev) / (n_prev + m)
             Rookies and QBs without a last season start from the league average.

Defaults come from a backtest over 2006-2025 (predicting each QB's rest-of-season
QER from his games so far): own-last-season prior with m = 300 and k = 250 beat a
league-average prior by about 4% overall and 5% in the first four weeks.
Recency weighting neither helped nor hurt on average (decay 0.95 cost ~0.1%), so a
mild 0.95 is kept: it lets roster changes (a star receiver returning, a new
play-caller) show up faster, which a league-wide average can't measure.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .formula import passer_rating


@dataclass(frozen=True)
class PowerParams:
    decay: float = 0.95           # each week back counts 5% less (backtest cost: ~0.1% accuracy)
    prior_dropbacks: float = 250  # k: weight of the starting point, in dropbacks
    prev_season_shrink: float = 300  # m: pulls last season toward its league average
    use_prev_season: bool = True  # False: start every QB from the league average
    min_game_dropbacks: int = 10  # games below this don't count (mop-up, early injury)
    active_weeks: int = 3         # must have played within this many weeks to be ranked
    min_games_ranked: int = 2     # fewer games -> shown as provisional, not ranked


def season_priors(prev_games: pd.DataFrame | None, p: PowerParams) -> pd.DataFrame:
    """Starting point per QB from last season: his QER pulled toward that league average."""
    if prev_games is None or prev_games.empty or not p.use_prev_season:
        return pd.DataFrame(columns=["qb_id", "prev_qer", "prev_dropbacks", "prior_own"])
    g = prev_games[prev_games.dropbacks >= p.min_game_dropbacks]
    league = float(np.average(g.qer, weights=g.dropbacks))
    agg = g.groupby("qb_id").apply(
        lambda d: pd.Series({"prev_qer": np.average(d.qer, weights=d.dropbacks),
                             "prev_dropbacks": d.dropbacks.sum()}), include_groups=False).reset_index()
    m = p.prev_season_shrink
    agg["prior_own"] = (agg.prev_dropbacks * agg.prev_qer + m * league) / (agg.prev_dropbacks + m)
    return agg


def _snapshot(hist: pd.DataFrame, week: int, p: PowerParams, priors: pd.DataFrame) -> pd.DataFrame:
    hist = hist.sort_values("week").copy()
    hist["wdb"] = p.decay ** (week - hist.week) * hist.dropbacks
    hist["wq"] = hist.wdb * hist.qer
    prior = float(np.average(hist.qer, weights=hist.dropbacks))

    snap = hist.groupby("qb_id").agg(
        qb_name=("qb_name", "last"), display_name=("display_name", "last"),
        headshot_href=("headshot_href", "last"), team=("team", "last"),
        last_week=("week", "max"), games=("game_id", "nunique"),
        dropbacks=("dropbacks", "sum"), wdb=("wdb", "sum"), wq=("wq", "sum"),
        season_qer=("qer", "mean"), best_qer=("qer", "max"),
        wins=("won", "sum"), losses=("result", lambda s: int((s == "L").sum())),
        ties=("result", lambda s: int((s == "T").sum())),
        epa_total=("total_epa", "sum"),
        comp=("comp", "sum"), att=("att", "sum"), yds=("yds", "sum"),
        td=("td", "sum"), ints=("ints", "sum"),
    )
    snap["last3_qer"] = hist.groupby("qb_id").tail(3).groupby("qb_id").qer.mean()
    rated = hist[hist.qbr.notna()]
    snap["season_qbr"] = (rated.qbr * rated.dropbacks).groupby(rated.qb_id).sum() / \
        rated.groupby("qb_id").dropbacks.sum()
    # season passer rating from summed box score, not an average of games
    snap["season_passer_rating"] = passer_rating(snap.comp, snap.att, snap.yds, snap.td, snap.ints)
    snap["epa_per_db"] = snap.epa_total / snap.dropbacks

    form = snap.wq / snap.wdb
    n = snap.dropbacks
    snap["form_qer"] = form
    own = priors.set_index("qb_id")["prior_own"] if not priors.empty else pd.Series(dtype=float)
    snap["prior"] = snap.index.map(own).astype(float)
    snap["prior_source"] = np.where(snap.prior.notna(), "last season", "league average")
    snap["prior"] = snap.prior.fillna(prior)
    snap["power"] = (n * form + p.prior_dropbacks * snap.prior) / (n + p.prior_dropbacks)
    snap["own_weight"] = n / (n + p.prior_dropbacks)
    snap["league_prior"] = prior
    snap["active"] = snap.last_week >= week - p.active_weeks + 1
    weeks_played = hist.week.nunique()
    snap["ranked"] = snap.active & (snap.games >= min(p.min_games_ranked, weeks_played))
    snap["power_rank"] = snap.loc[snap.ranked, "power"].rank(ascending=False, method="min")
    snap["week"] = week
    return snap.drop(columns=["wdb", "wq", "comp", "att", "yds", "td", "ints"]).reset_index()


def power_ratings(qb_games: pd.DataFrame, p: PowerParams = PowerParams(),
                  prev_games: pd.DataFrame | None = None) -> pd.DataFrame:
    """Weekly power-rating snapshots for every season in ``qb_games``.

    ``prev_games``: QB-games from the season before (any extra seasons in it are
    ignored). When ``qb_games`` holds several seasons, each season's prior comes
    from the season before it inside ``qb_games`` itself.
    """
    games = qb_games[qb_games.dropbacks >= p.min_game_dropbacks]
    if "display_name" not in games:
        games = games.assign(display_name=games.qb_name, headshot_href=None)
    out = []
    pool = pd.concat([d for d in (prev_games, qb_games) if d is not None and not d.empty], ignore_index=True)
    for season, sg in games.groupby("season"):
        priors = season_priors(pool[pool.season == season - 1], p)
        for week in sorted(sg.week.unique()):
            out.append(_snapshot(sg[sg.week <= week], int(week), p, priors).assign(season=season))
    if not out:
        return pd.DataFrame()
    res = pd.concat(out, ignore_index=True).sort_values(["season", "qb_id", "week"])
    res["prev_rank"] = res.groupby(["season", "qb_id"]).power_rank.shift(1)
    res["rank_change"] = res.prev_rank - res.power_rank
    return res.sort_values(["season", "week", "power_rank"]).reset_index(drop=True)
