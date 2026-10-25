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

QERParams.v2_2() reproduces the original workbook exactly; v2_3() and v2_4() are
the earlier versions.
"""
from __future__ import annotations

from dataclasses import dataclass

_WORKBOOK_SCALE = dict(b_floor=1.91, b_ceiling=9.93, c_pivot=2.75, c_ceiling_z=1.229, d_zero_cost=0.73)


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
    a_offset: float = 10.0             # CPOE (points) where A starts above 0: CPOE -10
    a_full_cpoe: float = 10.0          # CPOE where A reaches a_max: CPOE +10
    a_slope: float | None = None       # None -> a_max / (a_offset + a_full_cpoe)

    # B: efficiency (EPY per dropback)
    b_floor: float = 1.67              # 5th pct of EPY/DB, 2006-2025 (workbook: 1.91)
    b_ceiling: float = 9.93            # top 0.1% of EPY/DB, 2006-2025 (matches workbook)
    b_exponent: float = 0.65
    b_max: float = 3.0

    # C: scoring credit curve
    c_slope: float = 4.5               # C = slope * z below the pivot
    c_pivot: float = 2.36              # C value where the slope changes (workbook: 2.75)
    c_ceiling_z: float = 1.062         # top 0.1% of credit/DB, 2006-2025 (workbook: 1.229)
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
