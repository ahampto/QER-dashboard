"""Database access. Works with SQLite (local default) or Postgres (production).

Set DATABASE_URL to point at Postgres, e.g.
    postgresql+psycopg2://user:pass@host/dbname
Otherwise a local SQLite file at data/qer.db is used.
"""
from __future__ import annotations

import os
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

DEFAULT_SQLITE = Path(__file__).resolve().parent.parent / "data" / "qer.db"

# Tables and the columns that identify a "slice" we replace on each run.
TABLES = {
    "plays": "Slim nflverse play-by-play (raw input)",
    "games": "Schedule and final scores",
    "qbr_weekly": "ESPN Total QBR by QB-game",
    "qb_games": "One row per QB-game: box score, QER inputs and components, passer rating, QBR",
    "qb_drives": "Per QB scoring-drive credit (feeds QER component C)",
    "power_ratings": "Weekly QER power-rating snapshots",
    "players": "QB profiles: photo, jersey, college, draft (all seasons)",
    "injuries": "Weekly official injury reports",
    "teams": "Team names and colors",
    "pipeline_runs": "Audit log of pipeline runs",
}

INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_plays_season_week ON plays (season, week)",
    "CREATE INDEX IF NOT EXISTS ix_plays_game ON plays (game_id)",
    "CREATE INDEX IF NOT EXISTS ix_qb_games_season_week ON qb_games (season, week)",
    "CREATE INDEX IF NOT EXISTS ix_qb_games_qb ON qb_games (qb_id)",
    "CREATE INDEX IF NOT EXISTS ix_power_season_week ON power_ratings (season, week)",
]


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        # Heroku/Supabase/Neon often hand out postgres:// URLs
        return url.replace("postgres://", "postgresql+psycopg2://", 1)
    DEFAULT_SQLITE.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{DEFAULT_SQLITE}"


def get_engine(url: str | None = None) -> Engine:
    return create_engine(url or database_url(), future=True)


def table_exists(engine: Engine, name: str) -> bool:
    return inspect(engine).has_table(name)


def _sql_type(dtype) -> str:
    if pd.api.types.is_bool_dtype(dtype):
        return "BOOLEAN"
    if pd.api.types.is_integer_dtype(dtype):
        return "BIGINT"
    if pd.api.types.is_float_dtype(dtype):
        return "DOUBLE PRECISION"
    return "TEXT"


def _add_missing_columns(conn, table: str, df: pd.DataFrame) -> None:
    """Schema evolution: new metric columns get added instead of breaking the load."""
    existing = {c["name"] for c in inspect(conn).get_columns(table)}
    for col in df.columns:
        if col not in existing:
            conn.execute(text(f'ALTER TABLE {table} ADD COLUMN "{col}" {_sql_type(df[col].dtype)}'))


def replace_slice(engine: Engine, table: str, df: pd.DataFrame, where: dict) -> int:
    """Delete rows matching ``where`` then insert ``df``, in one transaction.

    Re-running for the same season is therefore idempotent, and works the same
    on SQLite and Postgres.
    """
    with engine.begin() as conn:
        if inspect(conn).has_table(table):
            _add_missing_columns(conn, table, df)
            cond = " AND ".join(f"{k} = :{k}" for k in where)
            conn.execute(text(f"DELETE FROM {table} WHERE {cond}"), where)
        if not df.empty:
            df.to_sql(table, conn, if_exists="append", index=False, chunksize=5000, method="multi"
                      if engine.dialect.name == "postgresql" else None)
    return len(df)


def ensure_indexes(engine: Engine) -> None:
    with engine.begin() as conn:
        existing = set(inspect(conn).get_table_names())
        for stmt in INDEXES:
            table = stmt.split(" ON ")[1].split(" ")[0]
            if table in existing:
                conn.execute(text(stmt))


def read_sql(engine: Engine, sql: str, **params) -> pd.DataFrame:
    with engine.connect() as conn:
        return pd.read_sql(text(sql), conn, params=params)


def replace_table(engine: Engine, table: str, df: pd.DataFrame) -> int:
    """Replace a small reference table (players, teams) in full."""
    with engine.begin() as conn:
        df.to_sql(table, conn, if_exists="replace", index=False, chunksize=5000)
    return len(df)


def prune_plays(engine: Engine, keep_from_season: int) -> int:
    """Delete raw plays older than ``keep_from_season``. Computed tables are kept.

    Raw play-by-play is the biggest table by far; a free hosted Postgres tier can't
    hold 20 seasons of it, but QER, drives and power ratings for those seasons are
    small and stay. Re-scoring an old season later means ingesting it again.
    """
    if not table_exists(engine, "plays"):
        return 0
    with engine.begin() as conn:
        res = conn.execute(text("DELETE FROM plays WHERE season < :s"), {"s": keep_from_season})
    return res.rowcount or 0
