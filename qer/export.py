"""Export the database to the JSON files the website reads.

    python -m qer.export                 # writes site/data/
    python -m qer.export --out other/dir

The site is static (plain HTML/JS, hostable for free on GitHub Pages), so instead of
querying the database from the browser, the pipeline writes small JSON files after
each run:

    manifest.json          seasons available, current season, when data was built
    teams.json             names and colors
    players.json           QB profiles (photo, jersey, college, draft) keyed by qb_id
    season_YYYY.json       one season: QB games, weekly power snapshots, schedule, QB injuries
    career.json            every QB game since 2006, slim, for the Compare page
    live_model.json        coefficients for the live QER estimate (see qer/live_model.py)

Big arrays are stored column-wise ({"cols": [...], "rows": [[...], ...]}) which is
about half the size of a list of objects; site/app.js turns them back into objects.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import math
import sys
from pathlib import Path

import pandas as pd

from . import db, live_model
from .params import DEFAULT_PARAMS

log = logging.getLogger("qer.export")
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "site" / "data"
QER_VERSION = "2.5"

GAME_COLS = ["week", "season_type", "game_id", "qb_id", "team", "opp", "home", "result", "pf", "pa",
             "qer", "qer_a", "qer_b", "qer_c", "qer_d", "qer_bonus", "passer_rating", "qbr",
             "comp", "att", "yds", "td", "ints", "sacks", "sack_yds", "fumbles", "fumbles_lost",
             "rush_att", "rush_yds", "rush_td", "cpoe", "epy", "epy_per_db", "epa_per_db", "dropbacks",
             "scoring_drives", "credit_z", "int_cost", "fumble_cost", "sack_cost", "qer_raw"]
POWER_COLS = ["week", "qb_id", "team", "games", "dropbacks", "power", "form_qer", "prior", "prior_source",
              "own_weight", "season_qer", "last3_qer", "best_qer", "season_passer_rating", "season_qbr",
              "epa_per_db", "wins", "losses", "ties", "active", "ranked", "power_rank", "rank_change",
              "league_prior"]
SCHED_COLS = ["game_id", "game_type", "week", "gameday", "gametime", "away_team", "home_team",
              "away_score", "home_score", "spread_line", "total_line", "away_qb_name", "home_qb_name",
              "stadium", "espn"]
CAREER_COLS = ["season", "week", "season_type", "game_id", "qb_id", "team", "opp", "home", "result", "pf", "pa",
               "qer", "passer_rating", "qbr", "epa_per_db", "dropbacks", "comp", "att", "yds", "td", "ints",
               "sacks", "rush_yds"]


def _clean(v):
    """JSON-safe scalar: NaN -> null, numpy -> python, floats rounded to 3 places."""
    if v is None:
        return None
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return int(v) if v.is_integer() and abs(v) < 1e9 else round(v, 3)
    return v


def columnar(df: pd.DataFrame, cols: list[str]) -> dict:
    cols = [c for c in cols if c in df.columns]
    return {"cols": cols, "rows": [[_clean(v) for v in row] for row in df[cols].itertuples(index=False)]}


def _records(df: pd.DataFrame) -> list[dict]:
    return [{k: _clean(v) for k, v in row.items()} for row in df.to_dict("records")]


def _write(path: Path, obj) -> int:
    text = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text, encoding="utf-8")
    return len(text)


def _q(engine, sql, **kw) -> pd.DataFrame:
    return db.read_sql(engine, sql, **kw)


def export(engine, out: Path = DEFAULT_OUT, seasons: list[int] | None = None) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    have = _q(engine, "SELECT DISTINCT season FROM qb_games ORDER BY season").season.astype(int).tolist()
    seasons = [s for s in (seasons or have) if s in have]
    sizes: dict[str, int] = {}

    teams = _q(engine, "SELECT * FROM teams") if db.table_exists(engine, "teams") else pd.DataFrame()
    sizes["teams.json"] = _write(out / "teams.json", _records(teams))

    all_games = _q(engine, "SELECT * FROM qb_games")
    players = _q(engine, "SELECT * FROM players") if db.table_exists(engine, "players") else pd.DataFrame()
    # every QB who appears in a game gets a profile, even without a players row
    names = all_games.groupby("qb_id").agg(display_name=("display_name", lambda s: s.mode().iat[0]),
                                           headshot_href=("headshot_href", "last"))
    seasons_by_qb = all_games.groupby("qb_id").season.apply(lambda s: sorted(set(int(x) for x in s)))
    prof = {}
    for qb_id, row in names.iterrows():
        prof[qb_id] = {"name": row.display_name, "seasons": seasons_by_qb[qb_id],
                       "photo": None, "photo_espn": _clean(row.headshot_href)}
    if not players.empty:
        for r in _records(players):
            if r["qb_id"] in prof:
                p = prof[r["qb_id"]]
                p.update(name=r.get("display_name") or p["name"], photo=r.get("headshot"),
                         jersey=r.get("jersey_number"), college=r.get("college_name"),
                         birth_date=r.get("birth_date"), height=r.get("height"), weight=r.get("weight"),
                         draft_year=r.get("draft_year"), draft_round=r.get("draft_round"),
                         draft_pick=r.get("draft_pick"), draft_team=r.get("draft_team"),
                         rookie_season=r.get("rookie_season"))
    sizes["players.json"] = _write(out / "players.json", prof)

    career = all_games[all_games.dropbacks >= 10].sort_values(["season", "week"])
    sizes["career.json"] = _write(out / "career.json", columnar(career, CAREER_COLS))

    manifest = {"generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes"),
                "qer_version": QER_VERSION, "seasons": [], "current_season": max(have) if have else None,
                "params": {k: ([_clean(x) for x in v] if isinstance(v, (tuple, list)) else _clean(v))
                           for k, v in DEFAULT_PARAMS.__dict__.items()}}
    for season in seasons:
        g = all_games[all_games.season == season].sort_values(["week", "qer"], ascending=[True, False])
        pw = _q(engine, "SELECT * FROM power_ratings WHERE season = :s ORDER BY week, power_rank", s=season)
        sc = _q(engine, "SELECT * FROM games WHERE season = :s", s=season)
        sc = sc.sort_values([c for c in ["week", "gameday", "gametime"] if c in sc.columns])
        inj = (_q(engine, "SELECT * FROM injuries WHERE season = :s AND position = 'QB'", s=season)
               if db.table_exists(engine, "injuries") else pd.DataFrame())
        final_weeks = sc.groupby("week").home_score.apply(lambda s: bool(s.notna().all()))
        complete = [int(w) for w, ok in final_weeks.items() if ok]
        weeks = sorted(int(w) for w in pw.week.unique())
        default_week = max([w for w in weeks if w in complete], default=max(weeks) if weeks else None)
        obj = {"season": season, "weeks": weeks, "default_week": default_week,
               "games": columnar(g, GAME_COLS), "power": columnar(pw, POWER_COLS),
               "schedule": columnar(sc, SCHED_COLS),
               "injuries": columnar(inj, ["week", "team", "player_id", "full_name", "report_status",
                                          "report_primary_injury", "practice_status"])}
        name = f"season_{season}.json"
        sizes[name] = _write(out / name, obj)
        manifest["seasons"].append({"season": season, "weeks": weeks, "default_week": default_week,
                                    "complete": bool(final_weeks.all()) if len(final_weeks) else False})
    model = live_model.fit(all_games)
    sizes["live_model.json"] = _write(out / "live_model.json", model)
    log.info("live QER model: %d games, mean error %.1f", model["n_games"], model["mae"])
    sizes["manifest.json"] = _write(out / "manifest.json", manifest)
    return sizes


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--database-url", default=None)
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sizes = export(db.get_engine(args.database_url), args.out)
    total = sum(sizes.values())
    log.info("wrote %d files, %.1f MB to %s", len(sizes), total / 1e6, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
