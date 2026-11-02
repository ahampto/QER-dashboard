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

## 12. How the live model weights old seasons

The weight depends on a season's age, not on how much new data there is. Each season back
counts 0.9 times the one after it: last season 0.9, 2016 about 0.35, 2006 about 0.12.

As 2026 adds games, its share grows on its own: about 5% of the model's weight after
week 8, and about 11% after a full season. When 2027 starts, 2026 drops to 0.9 and
everything older ages one step. That is the roll-off.

Walk-forward test, 2020 to 2026:

| Weighting | Average miss | 2026's share after week 8 |
|---|---|---|
| Equal weights | 6.58 | 2% |
| 0.9 per season (current) | 6.53 | 5% |
| 0.7 per season | 6.51 | 15% |

How box scores relate to QER has barely changed since 2006, so old seasons are still
useful. That is why steeper roll-off gains so little. Within-season week weighting was not
tested.

## 13. Tested and not adopted: throwaways in A (step 1a, November 2026)

**The idea.** A smart throwaway counts as a miss in A (CPOE), which can make a QB look
less accurate for making the right decision.

**What we found:**
- **nflverse already leaves most throwaways out of CPOE.** 82% of FTN-charted
  throwaways (2022-2026) have no intended receiver, and CPOE needs one, so A never counts
  them.
- **The other 18% (601 plays) still count.** They are logged with a receiver and average
  CPOE -56. They appear in 20% of starts. In those starts A is understated by 1.6 points on
  average (up to 9; Goff 2025 week 15 would go 66.4 -> 75.4).
- **Those 601 can't be found without FTN.** A model trained on every play-by-play field
  scored F1 0.09 (0 to 1 scale); they look exactly like ordinary misses. Using them
  would make QER provisional until FTN posts, about 4 days after the game.
- **Removing them with FTN didn't improve QER** (2022-2025, 2,315 starts):

  | Measure | Now | Throwaways removed |
  |---|---|---|
  | Consistency of A (odd vs even games) | 0.318 | 0.316 |
  | Consistency of QER | 0.483 | 0.479 |
  | Predicting rest-of-season EPA/dropback | 0.474 | 0.470 |
  | Predicting rest-of-season win % | 0.365 | 0.363 |

  It also pushes more games to A's 20-point cap (14.4% -> 15.6%).

**Decision:** not adopted. Revisit after the A recalibration, once A has room above
+10 CPOE.

**Related check: other FTN flags can't be learned from play-by-play either.**

| FTN flag | Best F1 from play-by-play |
|---|---|
| Drops | 0.32 |
| Interceptions that weren't the QB's fault | 0.38 |
| QB-fault sacks | 0.49, but no better than flagging every sack |

So any FTN-based change means a provisional QER until FTN posts. Each would need to earn
that delay.

## 14. Adopted: A recalibrated (QER v2.6, November 2026)

**The change.** A (accuracy) is still a straight line in CPOE, but it now runs from CPOE
-23 (0 points) to +21 (full 20). Before, it ran from -10 to +10. -23 and +21 are the
1st and 99th percentiles of 2006-2025 starts.

**Why.**
- **Under v2.5, 27% of starts sat on a clipped end.** +12 and +25 earned the same 20
  points, and -11 and -40 both earned 0.
- **EPA per dropback keeps rising steadily with CPOE past both ends,** about +0.13 per 5
  CPOE points with no flattening. So the shape stays a straight line, just wider.

**Effect (all seasons recomputed).**
- Average start 48.0 -> 48.3.
- Starts clipped at an end: 27% -> 2%.
- Average change per start: 2.8 points; 90% move 5 or less.
- Good-but-not-extreme accuracy games lose a few points (Geno Smith, 2026 week 8, CPOE
  +10.8: 82.4 -> 77.8). Poor-but-not-disastrous ones gain a few.

**Backtest** (2006-2025; 2022-2025 in brackets):

| Measure | v2.5 | v2.6 |
|---|---|---|
| Consistency of A (odd vs even games) | 0.417 (0.318) | 0.445 (0.372) |
| Predicting rest-of-season EPA/dropback | 0.489 (0.474) | 0.490 (0.494) |
| Predicting rest-of-season win % | 0.403 (0.365) | 0.409 (0.376) |

**Options rejected.**
- A curve like B's tied on the tests but contradicts the straight-line CPOE-EPA
  relationship. It would undervalue elite accuracy.
- A range of -15 to +27 (the 5th-percentile/top-0.1% rule used for B, C and D) lowered
  every QER by about 3, because CPOE is centered on 0.

**Reproducibility.** v2.5 is kept as `QERParams.v2_5()`.

## 15. Adopted: expected YAC replaces the 13-air-yard rule (QER v2.7, November 2026)

**The change.** On every completion, the QB's earned yards (EPY) = air yards + half of the
lesser of actual YAC and expected YAC. Expected YAC is nflverse's per-play estimate from
where the ball was caught, down, distance and field position. The same per-play credit
filters his pass EPA in C.

Before: no YAC credit on throws under 13 air yards, and half of all YAC on 13+. One yard of
depth could swing his credit by 15+ yards. For example, a 12-yard catch with 30 YAC
earned 12 yards, and a 13-yard catch with 30 YAC earned 28.

**Why each piece.**
- **Expected:** the QB gets credit for the normal YAC his placement and timing set up.
  Broken tackles and long runs stay the receiver's.
- **Lesser of actual and expected:** he is never credited YAC that didn't happen.
- **Half:** normal YAC is shared between QB and receiver. Half also limits how far
  screen-heavy games can climb.

**Missing data.** Where expected YAC is missing (about 5% of completions), that play keeps
the old rule.

**Recalibration.** The standing rule only:
- B floor 2.53 (5th percentile) and B ceiling 10.10 (top 0.1%) of EPY per dropback,
  2006-2025.
- C ceiling 1.074 (top 0.1% of credit per dropback).
- C's slope stays 4.5. A first draft lowered it to 4.21 only to hold the average at 48.3.
  That was reverted: see the principle below.

**Backtest, all 11,048 starts 2006-2025** (v2.6 -> v2.7):

| Measure | v2.6 | v2.7 |
|---|---|---|
| Consistency of QER (odd vs even games) | 0.498 | 0.507 |
| Consistency of B | 0.495 | 0.500 |
| Consistency of C | 0.458 | 0.467 |
| QER vs same-game EPA/dropback | 0.861 | 0.876 |
| Predicting rest-of-season EPA/dropback | 0.491 | 0.498 |
| Predicting rest-of-season win % | 0.408 | 0.414 |
| Predicting own rest-of-season QER | 0.507 | 0.514 |
| Average start | 48.3 | 49.0 |
| Median start | 47.9 | 48.7 |

The average rises because QBs now earn some short-throw YAC, which also raises their
share of scoring drives. The gains hold in 2006-2013 and 2014-2021. 2022-2025 is mixed:
consistency 0.498 -> 0.491, but every prediction measure improves.

**Size of the change.** Average change per start +0.7 (1.7 points either way).
- Biggest drops: games built on long YAC after deep throws, which used to get half of
  all of it. Hasselbeck 2011 week 4: two 15-yard throws became 65- and 42-yard runs
  where about 4 YAC was expected. Credit on those two plays fell from 83.5 to 33.7 yards.
- Biggest gains: short-passing games with normal YAC.

**Options rejected** (2022-2025 test):
- Full expected YAC: consistency 0.498 -> 0.465.
- Lesser of actual and expected at full weight: 0.481.
- Half of expected YAC, even when the actual was lower: 0.483.
These lifted screen and dump-off games too much.

**Vault: Burrow vs TEN and Maye at MIA, 2026 week 8.**

| | v2.5 | v2.6 | v2.7 |
|---|---|---|---|
| Maye | 83.3 | 80.1 | 78.0 |
| Burrow | 78.6 | 76.7 | 78.0 |

**Reproducibility.** v2.6 is kept as `QERParams.v2_6()`. Expected YAC is now ingested
with the plays (`xyac_mean_yardage`).

## Principle: change for a reason, not for the average (agreed November 2026)

A formula change is made because it makes football sense and the tests support it.
- If it moves the average start, the average moves. No setting is nudged only to pull it
  back.
- Scales are re-derived only with the standing rule (floors at the 5th percentile,
  ceilings at the top 0.1%) when a change alters a component's input.
- Whether the overall scale needs re-centering is its own decision, taken separately.

## 16. Tested and not adopted: C and D per drive instead of per dropback (November 2026)

**The idea.** C (scoring credit) and D (turnover/sack cost) are divided by dropbacks. A
high-volume passer then needs more scoring to earn the same C, and each of his turnovers
costs less in D. The alternative is to divide by the drives he played (median 10 per
start, about 3.3 dropbacks per drive).

**Results.** Per drive is a different unit (about 3x larger than per dropback), so for a
fair comparison each version's scale was matched to today's average. That matching was for
testing only. Results are 2006-2025, with 2022-2025 in brackets:

| Version | Consistency QER | Consistency C | Consistency D | Same-game win | Predict EPA | Predict win % | Predict own QER |
|---|---|---|---|---|---|---|---|
| Now: both per dropback | 0.506 (0.492) | 0.468 (0.485) | 0.249 (0.252) | 0.538 (0.513) | 0.499 (0.509) | 0.414 (0.385) | 0.515 (0.496) |
| C per drive | 0.538 (0.479) | 0.544 (0.434) | same | 0.498 (0.479) | 0.494 (0.495) | 0.400 (0.391) | 0.540 (0.490) |
| C per sqrt(dropbacks x drives) | 0.524 (0.487) | 0.509 (0.462) | same | 0.519 (0.498) | 0.498 (0.504) | 0.408 (0.388) | 0.528 (0.493) |
| D per drive | 0.489 (0.499) | same | 0.193 (0.212) | 0.560 (0.533) | 0.493 (0.503) | 0.418 (0.372) | 0.499 (0.488) |

**Reading.**
- **C per drive is more repeatable in older seasons but less in 2022-2025.** In both eras
  it tracks winning less and predicts EPA and wins worse. Scoring per drive leans on the
  offense around the QB (run game, drive count), which repeats because the team repeats,
  not because the QB does.
- **D per drive makes D less repeatable in both eras.**

**Decision:** keep both per dropback.

Effect on the vault game, C per drive: Maye 77.6 -> 69.6 (11 drives on only 23
dropbacks) and Burrow 77.6 -> 78.5.

## 17. Adopted: drawn pass interference is neutral (QER v2.8, November 2026)

**The change.** A scoring drive's total EPA, the denominator of the QB's share in C, leaves
out drawn defensive pass interference. A DPI neither lowers nor raises his share.

**Why.**
- **A drawn DPI is logged as a no-play with no passer.** Its EPA (about +1.9 on average)
  counted in the drive's total but never in the QB's numbers, so drawing a deep flag
  lowered his share.
- **Size, 2006-2025:** 3,597 of 46,362 scoring drives (7.8%) include one. The QB's
  average share on them was 0.32; it is 0.45 with the DPI left out. That was about 1 QER
  point per such drive.
- **Neutral rather than credited.** The receiver and the defender cause the flag too,
  and neutral doesn't require parsing the play text for passer and depth.

**Backtest** (2006-2025; 2022-2025 in brackets):

| Measure | v2.7 | v2.8 |
|---|---|---|
| Consistency of QER | 0.507 (0.491) | 0.509 (0.493) |
| Consistency of C | 0.467 (0.478) | 0.470 (0.480) |
| Predicting rest-of-season EPA/dropback | 0.498 (0.509) | 0.499 (0.511) |
| Predicting rest-of-season win % | 0.414 (0.382) | 0.415 (0.387) |
| Predicting own rest-of-season QER | 0.514 (0.495) | 0.518 (0.493) |
| Average start | 49.0 | 49.3 |

**Who changes.** Only starts with a drawn DPI on a scoring drive: +0.6 with one, +1.2 with
two, +2.0 with three or more. Largest: Josh Johnson 2025 week 18 (4 DPIs), 44.6 -> 54.8.

**Reproducibility.** v2.7 is kept as `QERParams.v2_7()`.

## 18. Adopted: garbage time counts half (QER v2.9, November 2026)

**The change.** A dropback taken when the offense's pre-snap win probability is under 5%
or over 95% counts 0.5x in every component:
- A: weighted CPOE.
- B: weighted EPY over weighted dropbacks.
- D: weighted costs over weighted dropbacks.
- C: each scoring drive weighted by the win probability when it started, over weighted
  dropbacks.

A game decided almost from the start (under 10 weighted dropbacks) is graded on all its
plays. About 16% of dropbacks are in garbage time, and 58% of starts have at least one.

**Why.** Plays after the game is decided say little about the QB:
- A trailing QB can pile up yards against a soft defense protecting a lead.
- A leading QB's late mistakes don't matter.

Plays that built the lead count in full, so QBs who create blowouts aren't punished.

**Backtest** (2006-2025; 2022-2025 in brackets). Half weight was tested against v2.7:

| Measure | Every play equal | Decided plays half (adopted) | Decided plays left out |
|---|---|---|---|
| Consistency of QER | 0.507 (0.491) | 0.501 (0.520) | 0.464 (0.529) |
| QER vs same-game EPA/dropback | 0.876 (0.873) | 0.866 (0.865) | 0.821 (0.821) |
| QER vs winning that game | 0.539 (0.515) | 0.556 (0.531) | 0.560 (0.530) |
| Predicting rest-of-season win % | 0.414 (0.382) | 0.420 (0.385) | 0.420 (0.387) |
| Predicting own rest-of-season QER | 0.514 (0.495) | 0.518 (0.508) | 0.504 (0.508) |
| Typical change per start | | 1.5 (90% within 4.7) | 3.6 (90% within 10.9) |

**Reading.**
- QER tracks winning better and predicts future games better in both eras.
- It is much more repeatable in recent seasons, and slightly less over 2006-2025 overall.
- It drifts a little from raw EPA, which counts every snap equally.
- QBs in losses drop about 0.8 on average and QBs in wins rise about 0.5.
- Leaving decided plays out entirely was rejected: single games swung by up to 60
  points (Eli Manning 2006 week 3, 60.7 -> 0.0).

**Example.** Derek Carr 2024 week 2 (won 44-19).
- 13 live dropbacks: 243 yards, CPOE +22, +20.8 EPA.
- 4 dropbacks with the game decided: 0 completions, a sack, and an interception at 100%
  win probability.
- Half weight on those 4 moves him from 79.2 to 91.9 (92.3 with v2.8's DPI rule).

**Open to future tests.** `garbage_weight` (0.5) and the 5%/95% cutoffs.

**Reproducibility.** v2.8 is kept as `QERParams.v2_8()`.

**Site.**
- The worked example shows counted dropbacks ("17 dropbacks (15.0 counted)") and how many
  came with the game decided.
- EPY per dropback is per counted dropback. EPA per dropback stays per actual dropback.

## Version summary

| Version | Change | Average start, 2006-2025 |
|---|---|---|
| v2.5 | Scale calibrated on all starts | 48.0 |
| v2.6 | A runs CPOE -23 to +21 | 48.3 |
| v2.7 | Expected YAC replaces the 13-air-yard rule | 49.0 |
| v2.8 | Drawn DPI neutral in scoring share | 49.3 |
| v2.9 | Garbage time counts half | 49.2 |

From v2.5 to v2.9 the average start moves 3.5 points; 90% of starts move 7.1 or less.
The site's "QER versions" table on How QER Works shows this history.
