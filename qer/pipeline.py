"""Pipeline: ingest raw data into the database, then compute QER from it.

    python -m qer.pipeline run --season 2026            # ingest + compute (daily job)
    python -m qer.pipeline run --season 2006-2026       # backfill a range of seasons
    python -m qer.pipeline ingest --season 2024 2025    # raw data only
    python -m qer.pipeline compute --season 2026        # recompute from what is in the DB
    python -m qer.pipeline run --keep-plays 2           # also delete raw plays older than 2 seasons

The compute step reads plays from the database, never from the download, so the
database is the single source of truth and QER can be re-scored (for example after
tuning a parameter) without downloading anything.
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys

import pandas as pd

from . import db, sources
from .features import drive_credits, qb_game_features
from .formula import passer_rating, score
from .params import DEFAULT_PARAMS, QERParams
from .power import PowerParams, power_ratings

log = logging.getLogger("qer.pipeline")


# ---------------------------------------------------------------- ingest
def ingest(engine, seasons: list[int], loaders=sources) -> dict:
    counts = {}
    for season in seasons:
        plays = loaders.load_pbp(season)
        counts[f"plays_{season}"] = db.replace_slice(engine, "plays", plays, {"season": season})
        log.info("season %s: %d plays, through week %s", season, len(plays), plays.week.max())
    sched = loaders.load_schedule(seasons)
    qbr = loaders.load_qbr(seasons)
    for season in seasons:
        counts[f"games_{season}"] = db.replace_slice(
            engine, "games", sched[sched.season == season], {"season": season})
        counts[f"qbr_{season}"] = db.replace_slice(
            engine, "qbr_weekly", qbr[qbr.season == season], {"season": season})
        if hasattr(loaders, "load_injuries"):
            inj = loaders.load_injuries(season)
            if not inj.empty:
                counts[f"injuries_{season}"] = db.replace_slice(engine, "injuries", inj, {"season": season})
    if hasattr(loaders, "load_players"):
        counts["players"] = db.replace_table(engine, "players", loaders.load_players())
        counts["teams"] = db.replace_table(engine, "teams", loaders.load_teams())
    db.ensure_indexes(engine)
    return counts


# ---------------------------------------------------------------- compute
def _norm_last(name: pd.Series) -> pd.Series:
    """'Penix Jr.' / 'M.Penix' / "O'Connell" -> 'penix' / 'penix' / 'oconnell'."""
    return (name.fillna("").str.replace(r"\b(Jr|Sr|II|III|IV|V)\.?$", "", regex=True)
                .str.replace(r"[^A-Za-z]", "", regex=True).str.lower())


def _attach_qbr(games: pd.DataFrame, qbr: pd.DataFrame) -> pd.DataFrame:
    """ESPN only publishes QBR for each team's main QB in a game, so subs stay blank."""
    games = games.copy()
    games["name_last"] = _norm_last(games.qb_name.str.split(".", n=1).str[-1])
    q = qbr[["season", "week", "team", "name_last", "qbr", "name_display", "headshot_href"]].copy()
    q["name_last"] = _norm_last(q.name_last.str.strip())
    q = q.drop_duplicates(["season", "week", "team", "name_last"])
    out = games.merge(q, on=["season", "week", "team", "name_last"], how="left")
    # Carry a QB's full name and headshot to weeks ESPN skipped (e.g. backup appearances)
    for col in ["name_display", "headshot_href"]:
        known = out.dropna(subset=[col]).groupby("qb_id")[col].agg(lambda s: s.mode().iat[0])
        out[col] = out[col].fillna(out.qb_id.map(known))
    out["display_name"] = out.name_display.fillna(out.qb_name)
    return out.drop(columns=["name_last", "name_display"])


def compute(engine, seasons: list[int], params: QERParams = DEFAULT_PARAMS,
            power_params: PowerParams = PowerParams()) -> dict:
    counts = {}
    for season in sorted(seasons):      # in order: each season's power starts from the one before
        plays = db.read_sql(engine, "SELECT * FROM plays WHERE season = :s", s=season)
        if plays.empty:
            log.warning("no plays in DB for %s; run ingest first", season)
            continue
        feats = qb_game_features(plays, params)
        scored = score(feats, params)
        scored["passer_rating"] = passer_rating(scored.comp, scored.att, scored.yds, scored.td, scored.ints)
        scored["epy_per_db"] = scored.epy / scored.dropbacks
        scored["epa_per_db"] = scored.total_epa / scored.dropbacks
        qbr = (db.read_sql(engine, "SELECT * FROM qbr_weekly WHERE season = :s", s=season)
               if db.table_exists(engine, "qbr_weekly") else pd.DataFrame(
                   columns=["season", "week", "team", "name_last", "qbr", "name_display", "headshot_href"]))
        scored = _attach_qbr(scored, qbr)
        scored["computed_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        counts[f"qb_games_{season}"] = db.replace_slice(engine, "qb_games", scored, {"season": season})

        weeks = plays.drop_duplicates("game_id").set_index("game_id").week
        drives = drive_credits(plays, params).assign(season=season)
        drives["week"] = drives.game_id.map(weeks)
        counts[f"qb_drives_{season}"] = db.replace_slice(engine, "qb_drives", drives, {"season": season})

        prev = (db.read_sql(engine, "SELECT * FROM qb_games WHERE season = :s", s=season - 1)
                if db.table_exists(engine, "qb_games") else None)
        if prev is None or prev.empty:
            log.warning("no %s QB-games in DB: every QB's power starts from the league average", season - 1)
        pr = power_ratings(scored, power_params, prev_games=prev)
        counts[f"power_{season}"] = db.replace_slice(engine, "power_ratings", pr, {"season": season})
        log.info("season %s: %d QB-games scored, power ratings through week %s",
                 season, len(scored), scored.week.max())
    db.ensure_indexes(engine)
    return counts


def log_run(engine, stage: str, seasons: list[int], counts: dict, status: str = "ok") -> None:
    row = pd.DataFrame([{
        "run_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "stage": stage, "seasons": ",".join(map(str, seasons)),
        "rows_written": int(sum(counts.values())), "status": status,
    }])
    with engine.begin() as conn:
        row.to_sql("pipeline_runs", conn, if_exists="append", index=False)


def current_season(today: dt.date | None = None) -> int:
    today = today or dt.date.today()
    return today.year if today.month >= 9 else today.year - 1


def parse_seasons(tokens: list[str] | None) -> list[int]:
    """'2026' -> [2026];  '2006-2008 2026' -> [2006, 2007, 2008, 2026]."""
    if not tokens:
        return [current_season()]
    out: set[int] = set()
    for tok in tokens:
        if "-" in tok:
            lo, hi = (int(x) for x in tok.split("-"))
            out.update(range(lo, hi + 1))
        else:
            out.add(int(tok))
    return sorted(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["ingest", "compute", "run"])
    ap.add_argument("--season", nargs="+", default=None,
                    help="season(s) or ranges, e.g. 2026 or 2006-2026 (default: current season)")
    ap.add_argument("--database-url", default=None, help="overrides DATABASE_URL")
    ap.add_argument("--keep-plays", type=int, default=None,
                    help="after running, delete raw plays older than this many seasons")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    seasons = parse_seasons(args.season)
    engine = db.get_engine(args.database_url)
    log.info("database: %s", engine.url.render_as_string(hide_password=True))
    counts: dict = {}
    try:
        if args.stage in ("ingest", "run"):
            counts |= ingest(engine, seasons)
        if args.stage in ("compute", "run"):
            counts |= compute(engine, seasons)
    except Exception:
        log_run(engine, args.stage, seasons, counts, status="failed")
        raise
    if args.keep_plays:
        keep_from = current_season() - args.keep_plays + 1
        log.info("pruned %d raw plays before %s", db.prune_plays(engine, keep_from), keep_from)
    log_run(engine, args.stage, seasons, counts)
    for k, v in counts.items():
        log.info("%-22s %8d rows", k, v)
    return 0


if __name__ == "__main__":
    sys.exit(main())
