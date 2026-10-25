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
- **Interception weight check.** One interception (about 4.4 EPA) costs about 4 QER
  points through D. Confirm this is the intended severity.
- **Opponent adjustment.**

## Models
- **Better live QER estimate.** Today's box-score model misses by about 7 points. Compute
  EPA live from ESPN play-by-play (down, distance, field position) with an open
  expected-points model; CPOE stays hard without live air yards.
- **Better pre-2006 QER estimate.**

## Site
- News feed.
- Compare more than two QBs at once.
- Simulation game (players with 1999+ data), last.
