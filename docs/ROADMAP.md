# Roadmap

Open work, in rough priority order. Formula changes are proposed and backtested first,
then adopted only after sign-off; old versions stay reproducible as presets in `qer/params.py`.

## Data unlock: FTN charting (free on nflverse, 2022 onward)
Hand-charted flags for every play, published within a few days of each game:
- throwaway
- interception-worthy (so a tipped ball or a receiver's error isn't on the QB, and a
  dropped interception still is)
- drop and catchable ball
- QB-fault sack
- screen pass, play action, out of pocket

2026 so far:
- 319 throwaways (CPOE on them averages -57)
- 148 interceptions, of which 25 were not charted interception-worthy
- 96 interception-worthy throws that weren't caught
- 285 drops (CPOE -68)
- 486 sacks, of which 115 were the QB's fault

Limit: there is no FTN data before 2022. Options:
- use it only from 2022 on, with an era note
- use it to calibrate rules that work from play-by-play alone
- use it for a companion number

## Formula
Testing plan agreed November 2026:
- Test on 2022 to 2025 starts (about 2,200), where FTN charting exists.
- Then confirm on 2026 to date.
- Nothing becomes official without sign-off.

Order matters, because cleaning A's inputs changes the scale A should be fit to:
1. Clean the inputs: throwaways (tested, not adopted), drops, interception-worthy,
   QB-fault sacks. (Drawn DPI is on hold.) None of these FTN flags can be learned from
   play-by-play, so each would make QER provisional until FTN posts.
2. Recalibrate A.
3. Expected YAC (it changes B and C together).
4. Per-drive vs per-dropback for C and D.
5. Garbage time.

Dropped: win bonus clutch rework. The current 25/45/65/80 bands stay.

Process: one change at a time. Each gets a full explanation of what changes and whether it
makes sense, test results, and sign-off before the next.

FTN timing: Sunday games' charting has arrived about Thursday (Week 7: Thursday morning;
Week 8's Thursday game: Saturday). A QER that uses FTN would be provisional Monday to
Thursday and could change once FTN lands. Each FTN test reports how much QER moves when
FTN arrives. The alternative is to use FTN only to tune play-by-play rules, which has no
delay and keeps every season comparable.

- **Recalibrate component A (CPOE): done in v2.6** (CPOE -23 to +21, straight line; see
  METHOD_NOTES section 14). Original note: A is linear from -10 to +10 CPOE. In 2006-2025
  starts, 14.4% of games are at or above +10 (A maxed) and 12.5% at or below -10 (A = 0),
  so 27% of games sit on a flat part, while B, C and D use top-0.1% ceilings. Games at
  +20 CPOE average 0.60 EPA/dropback versus 0.33 at +10 to +15, a difference A can't see.
  Options to backtest: keep; stretch to the 1st-99th percentile (about -23 to +21);
  concave curve like B. Check the effect on average QER and the win-bonus bands.
- **Interception weight check, with context.** One interception (about 4.4 EPA) costs about
  4 QER points through D. Confirm the severity, and don't over-punish low-damage picks:
  arm-punt deep balls on 3rd/4th-and-long, end-of-half heaves and tipped balls. EPA already
  makes a deep arm-punt cheaper than a short pick (it lands like a punt); test whether D
  needs an explicit rule on top of that. FTN's "interception-worthy" flag (2022 onward)
  answers the tipped-ball and receiver-error cases directly: 25 of 148 interceptions in 2026
  weren't on the QB, and 96 interception-worthy throws were dropped by the defense.
- **Throwaways: tested November 2026, not adopted** (see METHOD_NOTES section 13).
  nflverse already leaves 82% of them out of CPOE. The rest need FTN and didn't improve
  consistency. Revisit after the A recalibration. Original note: a smart throwaway lowers
  CPOE (A) like a miss. Play-by-play has no
  marker, but FTN charting does (2022 onward). Test leaving them out of A, and check the
  effect on pre-2022 comparability.
- **Drops.** A drop counts as a miss in A. FTN flags drops (2022 onward), so test the
  same treatment as throwaways.
- **QB-fault vs line-fault sacks (D).** FTN flags QB-fault sacks (about 1 in 4). Test
  weighting the others less.
- **Credit for drawn pass interference: done in v2.8 (neutral; see METHOD_NOTES section
  17).** Full or partial credit can be tested later. Original note: Play-by-play records DPI as a no-play with no
  passer or air yards, but the description has both ("J.Herbert pass incomplete deep right
  to ... Defensive Pass Interference, 24 yards"), so it can be parsed. A deep throw that draws a DPI currently counts as
  drive value the QB didn't create, lowering his share in C. Options to backtest: full
  credit, partial credit (for example half, since the receiver and the defender cause the
  flag too), or credit equal to what an average catchable ball at that spot is worth.
- **Expected YAC: done in v2.7** (air yards + half of the lesser of actual and expected
  YAC; see METHOD_NOTES section 15). Original note: (only if it sees defenders).** Today B and
  C give the QB no YAC credit on throws under 13 air yards (all the YAC goes to the
  receiver). Proposal: the QB gets the *expected* YAC and the receiver gets the rest
  (a 4-yard catch that usually yields 6 YAC but goes 59 would credit the QB with 10 yards).
  Condition: the expected-YAC model must account for defenders. nflverse's per-play model
  uses play-by-play only (air yards, field position, down and distance, pass location), not
  defender positions. Next Gen Stats' model does use defenders, but it is public only as
  weekly averages per receiver. Plan: backtest the free play-by-play version first and see how
  it performs; check the Next Gen Stats averages as a refinement.
- **Garbage time, next: asymmetric rule (raised November 2026).** v2.9 also softens a
  leading QB's late mistakes, and a pick at 100% win probability is still a bad throw.
  Test:
  - when trailing big, down-weight only good plays (the padding);
  - when leading big, keep interceptions, sacks and fumbles at full weight.
  Compare against v2.9's symmetric half weight. Test case: Carr 2024 week 2 (late INT and
  sack with the game decided: 79.2 -> 92.3 under v2.9).
- **Garbage time: done in v2.9 (half weight; see METHOD_NOTES section 18).** The weight
  (0.5) and the 5%/95% cutoffs are open to future tests. Original note: QER grades every
  dropback equally, including plays when the game is
  decided. Options to backtest: drop or down-weight plays outside 5-95% win probability (the
  common analytics convention), or only for the win bonus. Check that it doesn't punish QBs
  who build the blowout.
- **Opponent adjustment (DVOA-style), light and separate.** Keep game QER fixed: it grades
  the game against the defense actually faced, which is the point. Add a separate,
  deliberately mild opponent-adjusted QER for comparing performances across schedules
  (shrink the adjustment toward zero so a tough defense never turns a poor game into a
  good one). It updates as each defense's strength becomes clearer through the season.

- **Scoring per drive vs per dropback (C): tested November 2026, not adopted** (METHOD_NOTES
  section 16). Original note: C divides scoring credit by dropbacks, which
  rewards efficiency but can undersell a QB carrying a heavy passing load. Test grading
  credit per drive (or per scoring opportunity) instead. Test case below.
- **Security per dropback (D): tested, not adopted** (METHOD_NOTES section 16). Original note: Same question for D: spreading turnover cost over
  dropbacks makes a pick cheaper in a 50-dropback game than in a 25-dropback one. Test
  per-drive cost, or a per-dropback cost with a floor per turnover. Test case below.

### Test-case vault
Games to re-run whenever a formula change is backtested.
- **Carr at DAL, 2024 week 2 (won 44-19).** Outstanding while the game was live (13
  dropbacks, 243 yards, CPOE +22). Then 4 dropbacks with the game decided: 0 completions, a
  sack, an interception at 100% win probability. v2.9's half weight lifts him 79.2 -> 92.3.
  Should late mistakes in a won game count in full?
- **Re-examine: Burrow and Maye are tied at 78.0 under v2.7.** Two very different games:
  - Burrow: volume, 51 dropbacks, 5 TD, 3 INT, lots of YAC.
  - Maye: 23 dropbacks, efficient and clean.
  Look at what each component is rewarding, and whether the tie is right or a coincidence
  of offsetting rules.
- **Burrow vs TEN and Maye at MIA, 2026 week 8.**
  - QER: Maye 83.3, Burrow 78.6.
  - EPA per dropback: Burrow higher, 0.34 vs 0.28.
  - Burrow: 51 dropbacks, 462 yards, 5 TD, 3 INT. 188 of his yards (41%) were YAC.
    170 YAC on throws under 13 air yards got no credit. Nine completions were behind the
    line, and those subtract 21 air yards from his EPY.
  - nflverse expected YAC on Burrow's short completions: 145, against 153 actual. His
    receivers did about what's expected, so most of that YAC came from where and how he
    threw.
  - Under "air yards + expected YAC" for B, Burrow goes 18.9 -> 27.7 and Maye goes
    21.3 -> 28.1. Maye's receivers left 39 expected YAC on the field. Under "air + the
    lesser of actual and expected YAC": Burrow 24.7, Maye 23.7.
  - C: Burrow's 6 TD drives earn 27.9 credit over 51 dropbacks (0.55 per dropback).
    Maye's 4 scoring drives earn 15.2 over 23 (0.66).
  - D: Burrow's 3 INTs (all deep, 18-47 air yards, about -3.5 EPA each) cost 0.42 per
    dropback. Maye's 3 sacks and fumble cost 0.37 per dropback.

## QER v3: borrow strengths, avoid weaknesses
Ideas from established metrics, each to be tested the same way (repeatability, prediction,
sign-off) before it enters the formula.
- **EPA:** keeps situation value (down, distance, field position) but credits the QB for
  everything on the play. QER already limits this: B is yards-based with YAC filtered.
  Review where C and D still use raw EPA.
- **CPOE:** isolates accuracy but punishes drops and rewards easy completions behind a
  great line. Test the A recalibration first; drops are not in free data.
- **Success rate:** how often a dropback keeps the offense on schedule. Candidate
  *consistency* companion (shown next to QER) rather than a fifth component.
- **Turnover-worthy plays and dropped interceptions:** not available in free data; note
  as a known limit.

## Models
- **Better live QER estimate.** Box score + passer rating misses by about 6.5 points, and
  6.1 when ESPN's QBR is posted (walk-forward log for 2026 in `qer/estimate_log.py`).
  Recent-season weighting (0.9 per season) helped only slightly. Next step: compute
  EPA live from ESPN play-by-play (down, distance, field position) with an open
  expected-points model; CPOE stays hard without live air yards.
- **Better pre-2006 QER estimate.**

## Site
- News feed.
- Week page: option to mark the Super Bowl winner's QB in gold even when the loser has the
  higher QER (today gold = best QER of the week).
- Compare more than two QBs at once.
- Simulation game (players with 1999+ data), last.
