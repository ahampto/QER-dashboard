# QER method notes

Decisions made while building QER, and the reasoning behind each one. These notes are
the source for the final QER documentation once the formula is finalized. Each entry says
what was decided, why, and what evidence backed it.

Backtests use every regular-season start from 2006 to 2025 unless stated otherwise.

---

## 1. Three different numbers, three different jobs

| Number | Question it answers | Kind |
|---|---|---|
| **Game QER** | How well did he play in this game? | A grade. Fixed once posted. |
| **Season QER** | How did he grade this season? | A report: built from his game grades. |
| **Power rating** | Who is the best QB right now? | A judgment, used to order the rankings. |

Game QER and season QER describe what happened. The power rating is deliberately more
skeptical: it is the number the rankings sort by, so it has to resist small samples.

## 2. Game QER is per dropback, so game length doesn't change the scale

Every component is a rate:

- A (accuracy) uses CPOE, which is per attempt.
- B (efficiency) uses EPY per dropback.
- C (scoring) uses scoring credit per dropback.
- D (ball security) uses cost per dropback.

So a 5-dropback game and a 40-dropback game are graded on the same 0 to 100 scale. For
example, 5/5 for 150 yards with 3 TD, 0 INT and 0 sacks would grade near 100.

The one exception is the win bonus, which only exists once the game is final.

## 3. Every game is reported and counts

- **Game logs show every game,** however few dropbacks. A short game (a QB hurt or pulled
  early) is a normal game. It is not tagged or hidden.
- **Season QER counts every game, weighted by dropbacks.** A 4-dropback game counts as 4
  dropbacks, not as a full start.
  - Why: short games swing to the extremes. A plain average would let 4 snaps move a
    season by as much as a full start.
  - Example: a QB averaging 60 over 8 starts of 35 dropbacks, plus one 4-dropback game at
    about 10. The plain average gives 54.4; the dropback-weighted average gives 59.3.
  - The win bonus stays inside each game's grade, so it carries into the season figure.
    Pooling the season's raw stats into one big game would lose the bonus, which is why
    that approach was not used.
- **Last-3 QER** uses the same dropback weighting.

## 4. Power rating

- **It starts from a baseline.** The baseline is the QB's own last season, pulled toward
  that season's league average (m = 300 dropbacks). Rookies start from the league average.
- **The baseline fades with evidence.** It is worth k = 250 dropbacks, about 7 games.
- **Recent games count a little more:** each week back counts 5% less (decay 0.95).
- **Every game counts, weighted by dropbacks.** Before November 2026, games under 10
  dropbacks were dropped entirely.
- Evidence for the dropback weighting, from a backtest of 1,916 QB-weeks (power through
  weeks 4, 8 and 12, compared against each QB's average QER over the rest of the season):

  | Games counted | Average miss | Average miss for QBs who had a short game |
  |---|---|---|
  | By dropbacks, games under 10 skipped (old) | 7.48 | 8.09 |
  | **By dropbacks, every game (current)** | **7.47** | **8.07** |
  | Each game counted equally, every game | 7.48 | 8.32 |

  The game grade is valid at any length, but a short game says less about the QB: a few
  plays carry more luck than forty. That matters for a judgment like the power rating, not
  for a report like season QER.
- **Ranking eligibility:** a QB needs 2 starts (games of 10 or more dropbacks) and must have
  played within the last 3 weeks. This stops one-snap backups from filling the list.

## 5. Why short games can't win gold or count as a "best game"

| Starts, 2006 to 2025 | Games | Scored 90+ | Scored under 15 | Spread (standard deviation) |
|---|---|---|---|---|
| Under 14 dropbacks | 2,101 | 11.3% | 18.0% | 30.4 |
| 14+ dropbacks | 11,048 | 1.6% | 3.9% | 19.6 |

A short game is about 7 times as likely to score 90+. That isn't because those QBs played
better; one great play is the whole sample. Baseball's batting title requires a minimum
number of plate appearances for the same reason. So:

- **Week page.** Rankings and the gold/green highlights use starts of 14+ dropbacks. Shorter
  games are listed underneath as "Also played."
- **Best game, and the elite/poor counts on Compare,** use starts only.

## 6. Dropback thresholds (open: unify?)

Two thresholds exist today:

- **10 dropbacks:**
  - what counts as a start for ranking eligibility
  - best game
  - Compare's elite/poor counts and median
  - the non-QB rule (section 7)
  - when the live estimate first appears
- **14 dropbacks:**
  - the week-page ranking and highlights
  - the distribution and scatter charts
  - the "better than X% of starts" percentiles
  - the starts the live model was trained on

Proposal: unify on 14 for everything that means "a real start," and keep 10 only as the
point where the live estimate starts showing. Not yet decided.

## 7. Only quarterbacks

Trick-play passes by running backs and receivers (776 since 2006) are not QB games and are
dropped. A player counts if nflverse lists him as a QB, or if he had a game of 10 or more
dropbacks. The second rule keeps real starts by players listed at another position today,
such as Taysom Hill and Terrelle Pryor.

## 8. Plays QER leaves out

- **Spikes** are clock plays. They are not attempts or dropbacks. They don't affect A or B,
  and they are removed from C's drive credit.
- **Kneels** are not rushes or dropbacks.
- **Two-point tries** are not dropbacks or carries. They stay in the drive's total EPA.

## 9. Passer rating shown next to QER follows the NFL's official count

The site shows passer rating for comparison. It now counts a spike as an incomplete
attempt, as the NFL and ESPN do. Example: Bryce Young at GB in 2026 went 23/41 for 68.0
(not 23/40 for 69.7). This only affects the displayed passer rating. QER is unchanged.

The original v2.2 workbook left spikes out of passer rating. One example is Stafford vs
NYG in 2026: 134.3 in the workbook, 131.3 official.

## 10. Live QER estimate

- **Scale.** It predicts the end-of-game QER from the QB's current per-dropback rates.
  It reads as "on pace for," not as a grade for the half.
- **Two linear models,** fit on starts of 14+ dropbacks:
  - **Box score:** completion %, yards per attempt, TD/INT/sack rates, passer rating,
    rushing, fumbles lost, and the score.
  - **The same plus ESPN's live QBR,** used whenever ESPN has posted a real QBR.
- **Backtest** (fit on 2006 to 2019, tested on 2020 onward):

  | Inputs | Average miss | Within 10 points |
  |---|---|---|
  | Old box-score model | 6.95 | 76% |
  | Passer rating alone | 8.77 | 64% |
  | QBR alone | 9.84 | 58% |
  | Box score + passer rating + extras | 6.61 | 78% |
  | Box score + QBR | 6.29 | 80% |

  Passer rating alone and QBR alone are each worse than the box score. Passer rating is a
  fixed formula of the same box-score numbers. QBR rewards things QER leaves out, such as
  YAC and clutch weighting. Combined with the box score, QBR adds real information.
- **Mid-game caveats:**
  - Small samples. The estimate appears at 10 dropbacks, and "± typical" is the
    full-game miss.
  - The score features use the current score, so a leading QB gets some win-bonus credit
    early.
- **Live QBR.** Only ESPN's adjusted-QBR field is used. Values off the 0 to 100 scale, or
  equal to the passer rating, are rejected: ESPN's box score labels passer rating "QBR".
- **After the game.** Once the overnight run posts, the game card shows the official QER,
  passer rating and QBR. The estimate is kept for comparison.
- **Why not live play-by-play yet.** ESPN's live plays have no EPA or CPOE. C and D could
  be rebuilt live with an expected-points table. B could be approximated from
  "short"/"deep". A has no live substitute. See the roadmap.
- **Estimates on the Week and Matchups pages.** A game that has been played (or is in
  progress) but isn't in the official data yet gets an estimated QER from ESPN's box score.
  - On the Week page it is ranked with the official starts and drawn as a dashed card
    labeled "Estimate" or "Live est.", with no component bar, because A to D arrive only
    with the official QER.
  - On the Matchups page it is marked "est.".
  - The morning run replaces it with the official QER automatically.
  - Estimates are left out of the scatter, distribution and "where they disagree" panels,
    which use official games only.

## 11. Matchups page metrics

- **Power rating:** each QB's rating going into the game.
- **QER, passer rating or QBR, game played:** that game's number for the QB who actually
  played most. This shows how the matchup turned out.
- **QER, passer rating or QBR, upcoming game:** each QB's season figure going in.
