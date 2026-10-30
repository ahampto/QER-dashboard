"""The website's data files: built from a throwaway database, then read back."""
import json

import pytest

from qer import db
from qer.export import columnar, export
from qer.pipeline import compute, ingest, parse_seasons
from tests.test_pipeline import SEASON, fake_loaders


@pytest.fixture()
def site_data(tmp_path):
    eng = db.get_engine(f"sqlite:///{tmp_path / 'test.db'}")
    ingest(eng, [SEASON], loaders=fake_loaders())
    compute(eng, [SEASON])
    out = tmp_path / "data"
    export(eng, out)
    return out


def test_files_written(site_data):
    names = {p.name for p in site_data.iterdir()}
    assert {"manifest.json", "teams.json", "players.json", "career.json", f"season_{SEASON}.json"} <= names


def test_manifest_and_season(site_data):
    m = json.loads((site_data / "manifest.json").read_text())
    assert m["current_season"] == SEASON and m["seasons"][0]["season"] == SEASON
    s = json.loads((site_data / f"season_{SEASON}.json").read_text())
    games = [dict(zip(s["games"]["cols"], r)) for r in s["games"]["rows"]]
    stafford = next(g for g in games if g["qb_id"] == "00-0026498")
    assert stafford["passer_rating"] == 134.3 and stafford["qbr"] == 77.0


def test_players_cover_every_qb(site_data):
    players = json.loads((site_data / "players.json").read_text())
    s = json.loads((site_data / f"season_{SEASON}.json").read_text())
    ids = {r[s["games"]["cols"].index("qb_id")] for r in s["games"]["rows"]}
    assert ids <= set(players)


def test_columnar_cleans_nan_and_rounds():
    import pandas as pd
    t = columnar(pd.DataFrame({"a": [1.23456, float("nan")], "b": ["x", None]}), ["a", "b"])
    assert t == {"cols": ["a", "b"], "rows": [[1.235, "x"], [None, None]]}


def test_parse_seasons_ranges():
    assert parse_seasons(["2006-2008", "2026"]) == [2006, 2007, 2008, 2026]
    assert parse_seasons(["2025"]) == [2025]


def test_live_model_estimates_close_to_real_qer(site_data):
    """On the fixture's 2026 games the live estimate should be in the right range."""
    import pandas as pd

    from qer.live_model import predict
    model = json.loads((site_data / "live_model.json").read_text())
    s = json.loads((site_data / f"season_{SEASON}.json").read_text())
    g = pd.DataFrame([dict(zip(s["games"]["cols"], r)) for r in s["games"]["rows"]])
    g = g[g.dropbacks >= 14].assign(sack_yds=0)
    est = predict(model, g)
    assert est.between(0, 100).all()
    assert (est - g.qer).abs().mean() < 15


def test_manifest_has_qer_baseline(site_data):
    """The site's 'better than X% of starts' uses 101 percentiles from the manifest."""
    b = json.loads((site_data / "manifest.json").read_text())["qer_baseline"]
    q = b["quantiles"]
    assert len(q) == 101 and q == sorted(q) and 0 <= q[0] <= q[50] <= q[100] <= 100
    assert b["starts"] > 0 and q[0] <= b["median"] <= q[100]


def test_live_model_uses_qbr_when_present():
    """Two models: box score only, and box score + QBR. A row with a QBR uses the second."""
    import pandas as pd

    from qer.live_model import fit, passer_rating, predict
    assert round(float(passer_rating(17, 20, 175, 2, 0)), 1) == 136.5
    assert round(float(passer_rating(8, 16, 55, 0, 1)), 1) == 32.0
    rng = range(120)
    g = pd.DataFrame({"comp": [15 + i % 10 for i in rng], "att": 30, "yds": [200 + 3 * i for i in rng],
                      "td": [i % 4 for i in rng], "ints": [i % 3 for i in rng], "sacks": 2, "sack_yds": 12,
                      "rush_att": 3, "rush_yds": 10, "rush_td": 0, "fumbles_lost": 0, "pf": 24, "pa": 20,
                      "dropbacks": 32, "qbr": [30 + i % 60 for i in rng]})
    g["qer"] = 0.5 * g.qbr + 0.1 * g.yds / 3
    m = fit(g)
    assert m["qbr_model"] and "qbr" in m["qbr_model"]["coef"]
    with_qbr, without = predict(m, g.head(3)), predict(m, g.head(3).assign(qbr=float("nan")))
    assert (with_qbr - g.qer.head(3)).abs().max() < 1 and not with_qbr.equals(without)
