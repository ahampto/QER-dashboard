"""Download raw data from the public nflverse data releases.

nflverse rebuilds play-by-play nightly during the season (EPA, CPOE and drive
results included), so re-running the pipeline after a game day picks up the
new games.
"""
from __future__ import annotations

import io
import logging
import time
import urllib.error
import urllib.request

import pandas as pd

from .features import PLAY_COLUMNS

log = logging.getLogger(__name__)

BASE = "https://github.com/nflverse/nflverse-data/releases/download"
PBP_URL = BASE + "/pbp/play_by_play_{season}.parquet"
SCHEDULE_URL = BASE + "/schedules/games.csv"
QBR_URL = BASE + "/espn_data/qbr_week_level.parquet"
PLAYERS_URL = BASE + "/players/players.parquet"
INJURIES_URL = BASE + "/injuries/injuries_{season}.parquet"
TEAMS_URL = BASE + "/teams/teams_colors_logos.csv"

# ESPN uses a few different team codes from nflverse
ESPN_TEAM_FIX = {"WSH": "WAS", "LAR": "LA"}


def _fetch(url: str, retries: int = 3) -> bytes:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "qer-dashboard"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:       # the file doesn't exist (e.g. no injury reports before 2009)
                raise RuntimeError(f"not found: {url}") from e
            last = e
            log.warning("fetch failed (%s), retry %d: %s", url, attempt + 1, e)
            time.sleep(2 ** attempt)
        except Exception as e:  # network hiccups are common on CI runners
            last = e
            log.warning("fetch failed (%s), retry %d: %s", url, attempt + 1, e)
            time.sleep(2 ** attempt)
    raise RuntimeError(f"could not download {url}") from last


def load_pbp(season: int) -> pd.DataFrame:
    """Slim play-by-play for one season."""
    raw = pd.read_parquet(io.BytesIO(_fetch(PBP_URL.format(season=season))))
    missing = [c for c in PLAY_COLUMNS if c not in raw.columns]
    for c in missing:  # older seasons lack a few newer columns
        raw[c] = pd.NA
    return raw[PLAY_COLUMNS].copy()


def load_schedule(seasons: list[int]) -> pd.DataFrame:
    sched = pd.read_csv(io.BytesIO(_fetch(SCHEDULE_URL)))
    keep = ["game_id", "season", "game_type", "week", "gameday", "gametime", "away_team",
            "home_team", "away_score", "home_score", "spread_line", "total_line",
            "away_qb_name", "home_qb_name", "roof", "stadium", "espn"]
    return sched.loc[sched.season.isin(seasons), keep].copy()


def load_qbr(seasons: list[int]) -> pd.DataFrame:
    """ESPN weekly QBR, with team codes and playoff weeks aligned to nflverse."""
    q = pd.read_parquet(io.BytesIO(_fetch(QBR_URL)))
    q = q[q.season.isin(seasons)].copy()
    q["team"] = q.team_abb.replace(ESPN_TEAM_FIX)
    reg_weeks = q[q.season_type == "Regular"].groupby("season").game_week.max()
    q["week"] = q.game_week
    post = q.season_type != "Regular"
    q.loc[post, "week"] = q.loc[post, "season"].map(reg_weeks) + q.loc[post, "game_week"]
    keep = ["season", "week", "season_type", "team", "name_display", "name_last",
            "name_short", "qbr_total", "qbr_raw", "qb_plays", "epa_total", "headshot_href"]
    return q[keep].rename(columns={"qbr_total": "qbr", "epa_total": "espn_epa"})


def load_players() -> pd.DataFrame:
    """Quarterback profiles: name, photo, jersey, college, draft. One table for all seasons."""
    p = pd.read_parquet(io.BytesIO(_fetch(PLAYERS_URL)))
    p = p[p.position == "QB"]
    keep = ["gsis_id", "display_name", "short_name", "espn_id", "birth_date", "height", "weight",
            "headshot", "college_name", "jersey_number", "rookie_season", "last_season", "latest_team",
            "years_of_experience", "draft_year", "draft_round", "draft_pick", "draft_team"]
    return p[keep].rename(columns={"gsis_id": "qb_id"}).reset_index(drop=True)


def load_injuries(season: int) -> pd.DataFrame:
    """Weekly official injury reports (all positions, so receivers can be used later)."""
    try:
        raw = pd.read_parquet(io.BytesIO(_fetch(INJURIES_URL.format(season=season))))
    except RuntimeError:          # older seasons or a report not published yet
        log.warning("no injury report file for %s", season)
        return pd.DataFrame()
    keep = ["season", "game_type", "week", "team", "gsis_id", "position", "full_name",
            "report_primary_injury", "report_status", "practice_status"]
    return raw[[c for c in keep if c in raw]].rename(columns={"gsis_id": "player_id"})


def load_teams() -> pd.DataFrame:
    t = pd.read_csv(io.BytesIO(_fetch(TEAMS_URL)))
    return t[["team_abbr", "team_name", "team_nick", "team_conf", "team_division", "team_color", "team_color2"]]
