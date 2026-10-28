# Roadmap

Open work, in rough priority order. Formula changes are proposed and backtested first,
then adopted only after sign-off; old versions stay reproducible as presets in `qer/params.py`.

## Formula
- **Recalibrate component A (CPOE).** A is linear from -10 to +10 CPOE. In 2006-2025
  starts, 14.4% of games are at or above +10 (A maxed) and 12.5% at or below -10 (A = 0),
  so 27% of games sit on a flat part, while B, C and D use top-0.1% ceilings. Games at
  +20 CPOE average 0.60 EPA/dropback versus 0.33 at +10 to +15, a difference A can't see.
  Options to backtest: keep; stretch to the 1st-99th percentile (about -23 to +21);
  concave curve like B. Check the effect on average QER and the win-bonus bands.
- **Win bonus clutch robustness.** Reward game-winning drives and penalize late critical
  turnovers, without rewarding garbage-time stat padding (WPA-based clutch was rejected).
  Revisit whether the 25/45/65/80 bands fit the recalibrated scale.
- **Interception weight check, with context.** One interception (about 4.4 EPA) costs about
  4 QER points through D. Confirm the severity, and don't over-punish low-damage picks:
  arm-punt deep balls on 3rd/4th-and-long, end-of-half heaves and tipped balls. EPA already
  makes a deep arm-punt cheaper than a short pick (it lands like a punt); test whether D
  needs an explicit rule on top of that.
- **Throwaways.** A smart throwaway lowers CPOE (A) like a miss. Look for a reliable
  throwaway marker in the play-by-play and, if one exists, leave throwaways out of A.
- **Credit for drawn pass interference.** A deep throw that draws a DPI currently counts as
  drive value the QB didn't create, lowering his share in C. Options to backtest: full
  credit, partial credit (for example half, since the receiver and the defender cause the
  flag too), or credit equal to what an average catchable ball at that spot is worth.
- **Expected YAC instead of the 13-air-yard filter (only if it sees defenders).** Today B and
  C give the QB no YAC credit on throws under 13 air yards (all the YAC goes to the
  receiver). Proposal: the QB gets the *expected* YAC and the receiver gets the rest
  (a 4-yard catch that usually yields 6 YAC but goes 59 would credit the QB with 10 yards).
  Condition: the expected-YAC model must account for defenders. nflverse's per-play model
  uses play-by-play only (air yards, field position, down and distance, pass location), not
  defender positions. Next Gen Stats' model does use defenders, but it is public only as
  weekly averages per receiver. Plan: backtest the free play-by-play version first and see how
  it performs; check the Next Gen Stats averages as a refinement.
- **Garbage time.** QER grades every dropback equally, including plays when the game is
  decided. Options to backtest: drop or down-weight plays outside 5-95% win probability (the
  common analytics convention), or only for the win bonus. Check that it doesn't punish QBs
  who build the blowout. Pairs with the clutch item above.
- **Opponent adjustment (DVOA-style), light and separate.** Keep game QER fixed: it grades
  the game against the defense actually faced, which is the point. Add a separate,
  deliberately mild opponent-adjusted QER for comparing performances across schedules
  (shrink the adjustment toward zero so a tough defense never turns a poor game into a
  good one). It updates as each defense's strength becomes clearer through the season.

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
- **Better live QER estimate.** Today's box-score model misses by about 7 points. Compute
  EPA live from ESPN play-by-play (down, distance, field position) with an open
  expected-points model; CPOE stays hard without live air yards.
- **Better pre-2006 QER estimate.**

## Site
- News feed.
- Week page: option to mark the Super Bowl winner's QB in gold even when the loser has the
  higher QER (today gold = best QER of the week).
- Compare more than two QBs at once.
- Simulation game (players with 1999+ data), last.
