"""Turn nflverse play-by-play into one row per QB-game of QER inputs.

Definitions (reverse-checked against all 140 games in QER_v2_2_RANKED.xlsx):
  attempts   pass attempts, excluding sacks, spikes and two-point tries
  dropbacks  attempts + sacks. An intentional grounding is already a pass attempt
             in nflverse, so it counts once (the workbook counted it twice; set
             QERParams.add_groundings_to_dropbacks=True to reproduce that)
  EPY        per completion: air yards (= passing yards - YAC), plus half the YAC
             when air yards >= 13
  CPOE       mean nflverse cpoe over attempts
  costs      -EPA summed over the QB's interceptions and sacks. Fumbles (v2.4):
             every fumble charged to the QB costs a league-average expected cost
             (whoever recovers), plus half the actual EPA cost when it is lost.
             Only fumbles the official scorer charges to the QB count: on a bad
             snap the scorer charges the center, so the QB is never charged.
  credit z   scoring-drive credit per dropback; on each TD/FG drive
             share = clip((QB pass EPA, YAC-filtered + 0.65 * max(0, QB rush EPA))
                          / max(drive EPA, 1), 0, 1); credit = points * share
  YAC-filtered pass EPA scales each completion's EPA by clip(EPY / passing yards, 0, 1);
  incompletions, interceptions and sacks count in full.

One deliberate difference from the workbook: sacks are charged to the QB who
took them. The workbook charged every team sack to the listed QB, which
over-penalised starters in 12 of its 140 games where a backup also played.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .params import DEFAULT_PARAMS, QERParams

# Columns the pipeline keeps from nflverse pbp (everything QER, passer rating
# and the box score need). Keeping the plays table slim keeps the DB small.
PLAY_COLUMNS = [
    "game_id", "play_id", "season", "season_type", "week", "game_date",
    "home_team", "away_team", "home_score", "away_score", "posteam", "defteam",
    "drive", "fixed_drive_result", "play_type", "qtr", "down",
    "pass_attempt", "complete_pass", "sack", "qb_spike", "qb_kneel", "qb_scramble",
    "two_point_attempt", "penalty_type",
    "interception", "pass_touchdown", "rush_attempt", "rush_touchdown",
    "passing_yards", "rushing_yards", "yards_gained", "air_yards", "yards_after_catch",
    "epa", "yac_epa", "cpoe", "fumble", "fumble_lost", "aborted_play",
    "passer_player_id", "passer_player_name", "rusher_player_id", "rusher_player_name",
    "fumbled_1_player_id", "fumbled_2_player_id",
]


def _epy_per_play(plays: pd.DataFrame, p: QERParams) -> pd.Series:
    comp = plays["complete_pass"].fillna(0).eq(1)
    yac = plays["yards_after_catch"].fillna(0)
    air = plays["passing_yards"].fillna(0) - yac
    deep = plays["air_yards"].fillna(0) >= p.deep_air_yards
    return (air + np.where(deep, p.deep_yac_share * yac, 0)).where(comp, 0.0)


def _filtered_pass_epa(plays: pd.DataFrame, p: QERParams) -> pd.Series:
    comp = plays["complete_pass"].fillna(0).eq(1)
    yds = plays["passing_yards"].fillna(0)
    ratio = np.where(yds > 0, np.clip(_epy_per_play(plays, p) / yds.where(yds > 0, 1), 0, 1), 1.0)
    epa = plays["epa"].fillna(0)
    return pd.Series(np.where(comp, epa * ratio, epa), index=plays.index)


def game_results(plays: pd.DataFrame) -> pd.DataFrame:
    """One row per game-team with points for/against and W/L/T."""
    g = plays.groupby("game_id").agg(
        season=("season", "first"), week=("week", "first"), season_type=("season_type", "first"),
        game_date=("game_date", "first"), home_team=("home_team", "first"),
        away_team=("away_team", "first"), home_score=("home_score", "first"),
        away_score=("away_score", "first"),
    ).reset_index()
    home = g.assign(team=g.home_team, opp=g.away_team, pf=g.home_score, pa=g.away_score, home=True)
    away = g.assign(team=g.away_team, opp=g.home_team, pf=g.away_score, pa=g.home_score, home=False)
    out = pd.concat([home, away], ignore_index=True)
    out["result"] = np.select([out.pf > out.pa, out.pf < out.pa], ["W", "L"], "T")
    return out[["game_id", "season", "week", "season_type", "game_date", "team", "opp",
                "home", "pf", "pa", "result"]]


def drive_credits(plays: pd.DataFrame, p: QERParams = DEFAULT_PARAMS) -> pd.DataFrame:
    """Per QB, per scoring drive: drive EPA, QB pass/rush EPA, share and credit."""
    # Decide "scoring drive" once per drive (its most common label), then keep every
    # play of that drive: nflverse occasionally labels a single play differently.
    pl = plays[plays["drive"].notna() & plays["posteam"].notna()
               & plays["qb_spike"].fillna(0).eq(0)]   # spikes are clock plays, not QB value
    label = (pl.groupby(["game_id", "posteam", "drive"])["fixed_drive_result"]
               .agg(lambda s: s.mode().iat[0] if s.notna().any() else None)
               .rename("drive_label").reset_index())
    pl = pl.merge(label, on=["game_id", "posteam", "drive"])
    scoring = pl[pl["drive_label"].isin(["Touchdown", "Field goal"])].copy()
    if scoring.empty:
        return pd.DataFrame(columns=["game_id", "qb_id", "team", "drive", "drive_result",
                                     "drive_epa", "qb_pass_epa", "qb_rush_epa", "points",
                                     "share", "credit"])
    scoring["f_pass_epa"] = _filtered_pass_epa(scoring, p)
    key = ["game_id", "posteam", "drive"]
    drive = scoring.groupby(key).agg(drive_epa=("epa", "sum"),
                                     drive_result=("drive_label", "first")).reset_index()

    passes = (scoring[scoring.passer_player_id.notna()]
              .groupby(key + ["passer_player_id"])["f_pass_epa"].sum()
              .rename("qb_pass_epa").reset_index().rename(columns={"passer_player_id": "qb_id"}))
    rushes = (scoring[scoring.rusher_player_id.notna()]
              .groupby(key + ["rusher_player_id"])["epa"].sum()
              .rename("qb_rush_epa").reset_index().rename(columns={"rusher_player_id": "qb_id"}))
    # Only players who threw on the drive's team are QBs here; rushers join onto them.
    qb_ids = set(passes.qb_id)
    rushes = rushes[rushes.qb_id.isin(qb_ids)]
    qb_drive = passes.merge(rushes, on=key + ["qb_id"], how="outer")
    qb_drive = qb_drive.merge(drive, on=key, how="left").fillna({"qb_pass_epa": 0.0, "qb_rush_epa": 0.0})

    qb_drive["points"] = np.where(qb_drive.drive_result.eq("Touchdown"), p.td_points, p.fg_points)
    numer = qb_drive.qb_pass_epa + p.rush_lambda * qb_drive.qb_rush_epa.clip(lower=0)
    qb_drive["share"] = np.clip(numer / np.maximum(qb_drive.drive_epa, p.drive_epa_floor), 0, p.share_cap)
    qb_drive["credit"] = qb_drive.points * qb_drive.share
    return qb_drive.rename(columns={"posteam": "team"})


def qb_game_features(plays: pd.DataFrame, p: QERParams = DEFAULT_PARAMS,
                     min_dropbacks: int = 1) -> pd.DataFrame:
    """One row per QB-game with box-score stats and QER inputs."""
    pl = plays.copy()
    if "fumble" not in pl:   # plays ingested before v2.4 lack it; lost fumbles are still fumbles
        pl["fumble"] = pl["fumble_lost"]
    for c in ["pass_attempt", "complete_pass", "sack", "qb_spike", "qb_kneel", "interception",
              "pass_touchdown", "rush_attempt", "rush_touchdown", "fumble", "fumble_lost", "two_point_attempt"]:
        pl[c] = pl[c].fillna(0)
    full = pl                             # drive EPA keeps every play, incl. two-point tries
    pl = pl[pl.two_point_attempt.eq(0)]   # two-point tries are not dropbacks or carries

    dropback_mask = pl.passer_player_id.notna() & (pl.pass_attempt.eq(1) | pl.sack.eq(1))
    db = pl[dropback_mask].copy()
    db["is_att"] = (db.sack.eq(0) & db.qb_spike.eq(0)).astype(int)
    db["is_comp"] = db.is_att * db.complete_pass
    db["epy"] = _epy_per_play(db, p) * db.is_att
    db["cpoe_att"] = db.cpoe.where(db.is_att.eq(1))
    db["int_epa"] = -db.epa.where(db.interception.eq(1) & db.is_att.eq(1), 0)
    db["sack_epa"] = -db.epa.where(db.sack.eq(1), 0)
    db["sack_yds"] = -db.yards_gained.where(db.sack.eq(1), 0)
    db["pass_yds"] = db.passing_yards.fillna(0) * db.is_att
    db["grounding"] = (db.penalty_type.eq("Intentional Grounding") & db.is_att.eq(1)).astype(int)

    key = ["game_id", "posteam", "passer_player_id"]
    g = db.groupby(key).agg(
        qb_name=("passer_player_name", "last"),
        comp=("is_comp", "sum"), att=("is_att", "sum"), yds=("pass_yds", "sum"),
        td=("pass_touchdown", "sum"), ints=("interception", "sum"),
        sacks=("sack", "sum"), sack_yds=("sack_yds", "sum"),
        epy=("epy", "sum"), cpoe=("cpoe_att", "mean"),
        int_cost=("int_epa", "sum"), sack_cost=("sack_epa", "sum"),
        pass_epa=("epa", "sum"), groundings=("grounding", "sum"),
    ).reset_index().rename(columns={"posteam": "team", "passer_player_id": "qb_id"})
    g["dropbacks"] = g.att + g.sacks + (g.groundings if p.add_groundings_to_dropbacks else 0)

    # Rushing (designed runs + scrambles; kneels excluded)
    ru = pl[pl.rusher_player_id.isin(g.qb_id) & pl.rush_attempt.eq(1) & pl.qb_kneel.eq(0)]
    rush = ru.groupby(["game_id", "rusher_player_id"]).agg(
        rush_att=("rush_attempt", "sum"), rush_yds=("rushing_yards", "sum"),
        rush_td=("rush_touchdown", "sum"), rush_epa=("epa", "sum"),
    ).reset_index().rename(columns={"rusher_player_id": "qb_id"})

    # Fumbles charged to the QB: only plays where he is the listed fumbler
    # (the official scorer's call, so center-charged bad snaps never count)
    fl = pl[pl.fumble.eq(1) | pl.fumble_lost.eq(1)]
    cols = ["game_id", "epa", "fumble_lost"]
    fum = pd.concat([
        fl[cols + ["fumbled_1_player_id"]].rename(columns={"fumbled_1_player_id": "qb_id"}),
        fl[cols + ["fumbled_2_player_id"]].rename(columns={"fumbled_2_player_id": "qb_id"}),
    ]).dropna(subset=["qb_id"])
    fum["lost_cost"] = -fum.epa.where(fum.fumble_lost.eq(1), 0.0)
    fum = fum.groupby(["game_id", "qb_id"]).agg(
        fumbles=("epa", "size"), fumbles_lost=("fumble_lost", "sum"), lost_cost=("lost_cost", "sum")).reset_index()
    if p.fumble_rule == "lost_only":          # v2.2 / v2.3: only lost fumbles, at their actual cost
        fum["fumble_cost"] = fum.lost_cost
    else:                                      # v2.4: expected cost for every fumble + extra when lost
        fum["fumble_cost"] = fum.fumbles * p.fumble_expected_cost + p.fumble_lost_extra * fum.lost_cost

    credits = drive_credits(full, p)
    cred = credits.groupby(["game_id", "qb_id"]).agg(
        scoring_drives=("credit", "size"), drive_credit=("credit", "sum")).reset_index()

    out = (g.merge(rush, on=["game_id", "qb_id"], how="left")
            .merge(fum, on=["game_id", "qb_id"], how="left")
            .merge(cred, on=["game_id", "qb_id"], how="left"))
    fill0 = ["rush_att", "rush_yds", "rush_td", "rush_epa", "fumbles", "fumbles_lost", "lost_cost", "fumble_cost",
             "scoring_drives", "drive_credit"]
    out[fill0] = out[fill0].fillna(0)
    out["credit_z"] = out.drive_credit / out.dropbacks
    out["total_epa"] = out.pass_epa + out.rush_epa

    res = game_results(full)
    out = out.merge(res, on=["game_id", "team"], how="left")
    out["won"] = out.result.eq("W")
    out = out[out.dropbacks >= min_dropbacks]
    int_cols = ["comp", "att", "yds", "td", "ints", "sacks", "sack_yds", "groundings", "dropbacks",
                "rush_att", "rush_yds", "rush_td", "fumbles", "fumbles_lost", "scoring_drives"]
    out[int_cols] = out[int_cols].astype(int)
    return out.reset_index(drop=True)
