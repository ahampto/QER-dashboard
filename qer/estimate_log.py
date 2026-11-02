"""Estimate log: how the live QER estimate did on games that have since gone official.

    python -m qer.estimate_log                 # report for the current season
    python -m qer.estimate_log --backtest      # also compare recent-season weightings

For every week W, the estimate model is refit on only the games *before* week W (all
earlier seasons plus this season's weeks 1..W-1), then used to estimate week W from the
final box score. That reproduces what the model knew going into each week, so earlier
weeks can be backfilled and every new week is logged the same way.

Two estimates are logged per start:
    est_box   box score + passer rating (what the site shows before ESPN posts QBR)
    est_qbr   the same + QBR (when QBR exists for that start)
The box score is nflverse's final one; during a game the site uses ESPN's live box score,
which ends at the same numbers.
"""
from __future__ import annotations

import argparse
import sys

import numpy as np
import pandas as pd

from . import db, live_model


def walk_forward(games: pd.DataFrame, seasons: list[int], season_decay: float = live_model.SEASON_DECAY,
                 min_dropbacks: int = 14) -> pd.DataFrame:
    g = games[(games.dropbacks >= min_dropbacks) & (games.att > 0)]
    out = []
    for season in seasons:
        for week in sorted(g[g.season == season].week.unique()):
            train = g[(g.season < season) | ((g.season == season) & (g.week < week))]
            test = g[(g.season == season) & (g.week == week)]
            if train.empty or test.empty:
                continue
            m = live_model.fit(train, min_dropbacks, season_decay)
            est_box = live_model.predict({**m, "qbr_model": None}, test)
            est_qbr = live_model.predict(m, test).where(test.qbr.notna()) if m["qbr_model"] else np.nan
            out.append(pd.DataFrame({
                "season": season, "week": int(week), "game_id": test.game_id, "qb_id": test.qb_id,
                "team": test.team, "opp": test.opp, "dropbacks": test.dropbacks, "qer": test.qer,
                "est_box": est_box.round(1), "est_qbr": pd.Series(est_qbr, index=test.index).round(1),
                "trained_on": len(train)}))
    if not out:
        return pd.DataFrame()
    log = pd.concat(out, ignore_index=True)
    log["miss_box"] = (log.est_box - log.qer).round(1)
    log["miss_qbr"] = (log.est_qbr - log.qer).round(1)
    return log


def summary(log: pd.DataFrame, col: str = "miss_box") -> dict:
    m = log[col].dropna().abs()
    return {"starts": int(len(m)), "avg_miss": round(float(m.mean()), 2),
            "within_6": round(float((m <= 6).mean()), 3), "within_10": round(float((m <= 10).mean()), 3)}


def _plain(v):
    if isinstance(v, float) and np.isnan(v):
        return None
    return v.item() if hasattr(v, "item") else v


def payload(log: pd.DataFrame, season: int, model: dict) -> dict:
    """What the website shows: weekly accuracy plus every logged start."""
    weeks = []
    for w, d in (log.groupby("week") if not log.empty else []):
        s = summary(d)
        qbr = None if d.miss_qbr.isna().all() else round(float(d.miss_qbr.abs().mean()), 2)
        weeks.append({"week": int(w), "starts": s["starts"], "avg_miss": s["avg_miss"],
                      "within_6": s["within_6"], "within_10": s["within_10"], "avg_miss_qbr": qbr})
    cols = ["week", "game_id", "qb_id", "team", "opp", "dropbacks", "qer", "est_box", "est_qbr", "miss_box", "miss_qbr"]
    rows = [] if log.empty else [[_plain(v) for v in r] for r in log[cols].itertuples(index=False)]
    has_qbr = not log.empty and log.miss_qbr.notna().any()
    return {"season": season, "season_decay": model.get("season_decay"),
            "trained_through": model.get("trained_through"), "n_games": model.get("n_games"),
            "box": summary(log) if not log.empty else None,
            "with_qbr": summary(log, "miss_qbr") if has_qbr else None,
            "weeks": weeks, "log": {"cols": cols, "rows": rows}}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, default=None)
    ap.add_argument("--backtest", action="store_true", help="compare recent-season weightings, 2020+")
    ap.add_argument("--database-url", default=None)
    a = ap.parse_args(argv)
    games = db.read_sql(db.get_engine(a.database_url), "SELECT * FROM qb_games")
    season = a.season or int(games.season.max())
    log = walk_forward(games, [season])
    print(f"{season}: box {summary(log)} | with QBR {summary(log, 'miss_qbr')}")
    print(log.groupby("week").miss_box.apply(lambda s: round(s.abs().mean(), 2)).to_string())
    if a.backtest:
        seasons = [s for s in range(2020, season + 1) if s in set(games.season)]
        for d in (1.0, 0.95, 0.9, 0.85, 0.8, 0.7):
            lg = walk_forward(games, seasons, d)
            print(f"decay {d:.2f}: box {summary(lg)} | with QBR {summary(lg, 'miss_qbr')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
