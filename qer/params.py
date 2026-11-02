"""QER parameters.

Mirrors the "Assumptions" tab of QER_v2_2_RANKED.xlsx, so a change to the model
is a change to one value here.

v2.3 (default) fixes two values that still assumed the old 1.5 component max
after A and D were raised to 2:
  * A's slope was 0.075 = 1.5 / 20, so CPOE +10 only earned 1.5 of 2. The slope is
    now derived from a_max, so CPOE +10 earns the full a_max again.
  * D started at 1.5, so a game with no sacks, picks or fumbles scored 1.5 of 2.
    D now starts at d_max.

v2.4 (default) changes how fumbles count in D. Every fumble charged to the QB
(lost or recovered) costs a league-average expected cost, and a lost fumble adds
half its actual EPA cost on top. Recovery is largely luck, so this charges the QB
for fumbling while still making a lost fumble cost about twice a recovered one.
Backtest 2006-2025: D consistency 0.228 -> 0.246, prediction unchanged.

v2.5 (default) recalibrates the scale on all 11,048 starts from 2006-2025 instead
of the 140-game workbook sample, keeping the workbook's own definitions, with
ceilings at the top 0.1% so a single fluke game can't set the scale:
  B floor     1.91  -> 1.67    5th percentile of EPY/DB (1.91 zeroed 7.3% of starts)
  B ceiling   9.93  (kept)     already exactly the top 0.1%
  C ceiling   1.229 -> 1.062   top 0.1% of scoring credit per dropback
  D zero      0.73  -> 1.035   97th percentile of cost per dropback (0.73 zeroed 10.8%)
  C pivot     2.75  -> 2.36    restores the original top-end shape after C's max went
                               3.5 -> 3 (average and good games unchanged; only elite
                               scoring games spread out)
Backtest: average start 48.0, QER consistency 0.456 -> 0.463, prediction unchanged.

v2.6 (default) recalibrates A. A was a straight line from CPOE -10 (0 points) to +10
(full), so 27% of starts sat on a clipped end: +12 and +25 earned the same, and so did
-11 and -40. EPA per dropback keeps rising steadily with CPOE well past both ends
(about +0.13 per 5 CPOE points, no flattening), so A stays a straight line but now runs
from CPOE -23 to +21, the 1st to 99th percentile of 2006-2025 starts.
  - CPOE 0 still earns about half of A, so the middle of the scale doesn't move.
  - Starts clipped at an end: 27% -> 2%.
  - Backtest 2006-2025 (2022-2025 in brackets):
      A consistency, odd vs even games    0.417 -> 0.445 (0.318 -> 0.372)
      predicting rest-of-season EPA/DB    0.489 -> 0.490 (0.474 -> 0.494)
      predicting rest-of-season win %     0.403 -> 0.409 (0.365 -> 0.376)
      average start                       48.0  -> 48.3
  - A curve like B's tied on these tests but was rejected: CPOE's link to EPA is a
    straight line. A range of -15 to +27 lowered every QER by about 3.

v2.7 (default) replaces the 13-air-yard YAC cliff. Before, the QB got no YAC on throws
under 13 air yards and half of all YAC on 13+, so one yard of depth could swing his credit
by 15+ yards. Now, on every completion, he gets air yards + half of the lesser of actual
and expected YAC (nflverse's per-play model: where the catch was made, down, distance,
field position). Normal YAC is shared between his placement and the receiver; anything
beyond normal stays the receiver's, and he's never credited YAC that didn't happen. The
same per-play credit filters his pass EPA in C. B's floor/ceiling and C's ceiling were
re-derived with the standing rule (5th pct / top 0.1% of 2006-2025). Nothing was tuned to
hold the average: it rises from 48.3 to 49.0 because QBs now earn some short-throw YAC.
Backtest 2006-2025, v2.6 -> v2.7:
    consistency (odd vs even games)    QER 0.498 -> 0.507   B 0.495 -> 0.500   C 0.458 -> 0.467
    QER vs same-game EPA/dropback      0.861 -> 0.876
    predicting rest of season          EPA 0.491 -> 0.498   win % 0.408 -> 0.414   own QER 0.507 -> 0.514
    average start 48.3 -> 49.0; average change per start +0.7 (1.7 either way)
Where expected YAC is missing (about 5% of completions), that play keeps the old rule.

v2.8 (default) stops drawn pass interference from lowering the QB's scoring share. A DPI is
logged as a no-play with no passer, so its EPA (about +1.9) counted in the drive's total but
never in his numbers. 7.8% of scoring drives include one; his share on them was 0.32 and is
0.45 with the DPI left out of the drive total (no credit, no penalty). Backtest 2006-2025,
v2.7 -> v2.8: consistency 0.507 -> 0.509, C 0.467 -> 0.470, predicting win % 0.414 -> 0.415,
own QER 0.514 -> 0.518. Only starts with a drawn DPI on a scoring drive change (+0.6 with one,
+1.2 with two, +2.0 with three or more). Average start 49.0 -> 49.3.

v2.9 (default) counts garbage time at half weight. Dropbacks with the offense's pre-snap win
probability under 5% or over 95% (about 16% of dropbacks) count half in A-D; scoring drives
are weighted by the win probability when the drive started. A game decided almost from the
start (under 10 weighted dropbacks) is graded on all its plays. Backtest, v2.8 -> v2.9:
    2006-2025: consistency 0.509 -> 0.501, QER vs same-game win 0.540 -> 0.556,
               predicting win % 0.415 -> 0.420, own QER 0.518 -> 0.518 (half-weight test on v2.7:
               0.514 -> 0.518)
    2022-2025: consistency 0.493 -> 0.520, predicting own QER 0.493 -> 0.508
QER tracks winning and predicts better, and is less tied to raw EPA (0.876 -> 0.866), which
counts every snap equally. QBs in losses drop about 0.8 on average, QBs in wins rise about
0.5; plays that built a lead still count in full. Leaving decided plays out entirely was
rejected (single games swung up to 60 points). garbage_weight 0.5 and the 5%/95% cutoffs
are both open to future tests.

QERParams.v2_2() reproduces the original workbook exactly; v2_3() to v2_8() are the
earlier versions.
"""
from __future__ import annotations

from dataclasses import dataclass

_A_V25 = dict(a_offset=10.0, a_full_cpoe=10.0)          # A before v2.6: CPOE -10 to +10
_V27 = dict(dpi_rule="count", garbage_weight=1.0)      # before v2.8 / v2.9
# B and C before v2.7 (13-air-yard YAC rule)
_YAC_V26 = dict(yac_rule="deep_half", b_floor=1.67, b_ceiling=9.93, c_ceiling_z=1.062)
_WORKBOOK_SCALE = dict(**_A_V25, **_V27, yac_rule="deep_half",
                       b_floor=1.91, b_ceiling=9.93, c_pivot=2.75, c_ceiling_z=1.229, d_zero_cost=0.73)


@dataclass(frozen=True)
class QERParams:
    # C: drive scoring credit
    rush_lambda: float = 0.65          # weight on positive QB rush EPA
    td_points: float = 6.0
    fg_points: float = 3.0
    drive_epa_floor: float = 1.0       # share denominator never below this
    share_cap: float = 1.0             # QB never credited with >100% of a drive

    # A: accuracy (CPOE)
    a_max: float = 2.0
    a_offset: float = 23.0             # A starts above 0 at CPOE -23 (1st pct of starts; v2.5: -10)
    a_full_cpoe: float = 21.0          # A reaches a_max at CPOE +21 (99th pct; v2.5: +10)
    a_slope: float | None = None       # None -> a_max / (a_offset + a_full_cpoe)

    # B: efficiency (EPY per dropback)
    b_floor: float = 2.53              # 5th pct of EPY/DB, 2006-2025, expected-YAC rule (v2.6: 1.67)
    b_ceiling: float = 10.10           # top 0.1% of EPY/DB, same (v2.6: 9.93)
    b_exponent: float = 0.65
    b_max: float = 3.0

    # C: scoring credit curve
    c_slope: float = 4.5               # C = slope * z below the pivot
    c_pivot: float = 2.36              # C value where the slope changes (workbook: 2.75)
    c_ceiling_z: float = 1.074         # top 0.1% of credit/DB, 2006-2025, v2.7 (v2.6: 1.062; workbook: 1.229)
    c_max: float = 3.0

    # D: ball security
    d_start: float | None = None       # None -> d_max (a clean game earns full D)
    d_zero_cost: float = 1.035         # 97th pct of cost per dropback, 2006-2025 (workbook: 0.73)
    d_w_int: float = 1.5
    d_w_fumble: float = 1.5
    d_w_sack: float = 1.0
    d_max: float = 2.0
    # Fumbles (v2.4). "middle": expected cost per fumble + extra share of a lost fumble's
    # actual cost. "lost_only": v2.2/v2.3 rule, lost fumbles at actual cost only.
    fumble_rule: str = "middle"
    fumble_expected_cost: float = 2.90   # EPA: average cost of a QB fumble, 2006-2025, all outcomes
    fumble_lost_extra: float = 0.5       # share of a lost fumble's actual EPA cost added on top

    # Component weights (should sum to 100)
    w_a: float = 20.0
    w_b: float = 30.0
    w_c: float = 30.0
    w_d: float = 20.0

    # Win bonus (wins only), by Raw band upper limits
    bonus_bands: tuple[float, ...] = (25.0, 45.0, 65.0, 80.0)
    bonus_values: tuple[float, ...] = (1.0, 2.0, 3.0, 4.0, 5.0)
    final_cap: float = 100.0

    # EPY: share of YAC credited on completions with air yards >= this
    deep_air_yards: float = 13.0
    deep_yac_share: float = 0.5
    # "deep_half": the rule above (v2.6 and earlier). "expected": the QB gets yac_share of the
    # lesser of actual and expected YAC on every completion (see qer/features._epy_per_play)
    yac_rule: str = "expected"
    yac_share: float = 0.5
    # "count": drawn DPI adds to the drive's EPA but not the QB's (v2.7 and earlier).
    # "neutral": drawn DPI is left out of the drive's EPA, so it neither helps nor hurts his share.
    dpi_rule: str = "neutral"
    # Garbage time: dropbacks taken when the offense's pre-snap win probability is outside
    # [garbage_wp_lo, garbage_wp_hi] count garbage_weight as much in A-D (1.0 = no change).
    # Scoring drives are weighted by the win probability when the drive started.
    garbage_weight: float = 0.5
    garbage_wp_lo: float = 0.05
    garbage_wp_hi: float = 0.95

    # The workbook used DB = attempts + sacks + groundings, but nflverse already counts
    # an intentional grounding as a pass attempt, so adding it again double-counts it.
    # False (default) counts each grounding once. True reproduces the v2.2 workbook.
    add_groundings_to_dropbacks: bool = False

    # ---- derived (the workbook's "do not edit" block) ----
    @property
    def a_slope_eff(self) -> float:
        return self.a_slope if self.a_slope is not None else self.a_max / (self.a_offset + self.a_full_cpoe)

    @property
    def d_start_eff(self) -> float:
        return self.d_start if self.d_start is not None else self.d_max

    @classmethod
    def v2_2(cls) -> "QERParams":
        """The original QER v2.2 workbook, including its double-counted groundings."""
        return cls(a_slope=0.075, d_start=1.5, add_groundings_to_dropbacks=True, fumble_rule="lost_only",
                   **_WORKBOOK_SCALE)

    @classmethod
    def v2_3(cls) -> "QERParams":
        """v2.3: A and D maxes fixed, fumbles still lost-only, workbook scale."""
        return cls(fumble_rule="lost_only", **_WORKBOOK_SCALE)

    @classmethod
    def v2_4(cls) -> "QERParams":
        """v2.4: new fumble rule, workbook scale."""
        return cls(**_WORKBOOK_SCALE)

    @classmethod
    def v2_5(cls) -> "QERParams":
        """v2.5: A as a straight line from CPOE -10 to +10."""
        return cls(**_A_V25, **_YAC_V26, **_V27)

    @classmethod
    def v2_6(cls) -> "QERParams":
        """v2.6: half the YAC only on throws of 13+ air yards."""
        return cls(**_YAC_V26, **_V27)

    @classmethod
    def v2_7(cls) -> "QERParams":
        """v2.7: drawn pass interference still counted in the drive's EPA; no garbage-time weighting."""
        return cls(**_V27)

    @classmethod
    def v2_8(cls) -> "QERParams":
        """v2.8: no garbage-time weighting."""
        return cls(garbage_weight=1.0)

    @property
    def c_pivot_z(self) -> float:
        return self.c_pivot / self.c_slope

    @property
    def c_upper_slope(self) -> float:
        return (self.c_max - self.c_pivot) / (self.c_ceiling_z - self.c_pivot_z)

    def validate(self) -> None:
        total = self.w_a + self.w_b + self.w_c + self.w_d
        if abs(total - 100) > 1e-9:
            raise ValueError(f"Component weights sum to {total}, not 100")
        if len(self.bonus_values) != len(self.bonus_bands) + 1:
            raise ValueError("bonus_values needs one more entry than bonus_bands")


DEFAULT_PARAMS = QERParams()
