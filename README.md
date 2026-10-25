# QER: QB Efficiency Rating

An original NFL quarterback metric, with an automated data pipeline, a SQL database and a
live website that updates itself every morning of the season.

**Live site: https://ahampto.github.io/QER-dashboard/**

<a href="https://ahampto.github.io/QER-dashboard/"><img src="docs/screenshot.png" alt="QER rankings" width="100%"></a>

## What it does

- **Grades every QB start since 2006** on a 0–100 scale, built from play-by-play data.
- **Ranks QBs every week** by a power rating, season QER, last-3 QER, passer rating or ESPN QBR.
- **Compares any two QBs** on QER, passer rating or QBR, filtered by opponent, seasons or
  playoffs, including the games they played against each other.
- **QB pages** with game logs, a breakdown of each grade, career history and injury status.
- **Live scores**, with a live QER estimate for games in progress.

## What QER measures

QER combines four parts of quarterback play: **accuracy** (completion percentage over
expected), **efficiency** (yards the QB created per dropback), **scoring** (his share of
touchdown and field goal drives) and **ball security** (expected points lost to
interceptions, fumbles and sacks), plus a small bonus for winning. The site's
*How QER Works* page explains each part with a worked example.

## Built with

Python (pandas, NumPy, SQLAlchemy), SQLite / PostgreSQL, vanilla JavaScript, GitHub Actions
and GitHub Pages, with pytest for testing.

## Data

Play-by-play, schedules, rosters, injuries and QBR from
[nflverse](https://github.com/nflverse/nflverse-data) (CC-BY 4.0). Live scores from ESPN's
public scoreboard.
