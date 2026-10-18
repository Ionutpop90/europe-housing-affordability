"""
Step 1 — Extract.
Pulls every housing indicator used in the analysis from the Eurostat
Dissemination API (JSON-stat 2.0) plus the GISCO country boundaries,
and stores them untouched in data/raw/.

Run:  python src/fetch_data.py
"""
from __future__ import annotations

import itertools
from pathlib import Path

import pandas as pd
import requests

API = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{dataset}"
GISCO = "https://gisco-services.ec.europa.eu/distribution/v2/countries/geojson/CNTR_RG_20M_2024_4326.geojson"
RAW = Path(__file__).resolve().parents[1] / "data" / "raw"

EU27 = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU",
        "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"]
GEO = EU27 + ["EU27_2020"]


def fetch(dataset: str, **params) -> pd.DataFrame:
    """Query one Eurostat dataset and flatten the JSON-stat cube into a long DataFrame."""
    query = [("format", "JSON"), ("lang", "EN")]
    for key, value in params.items():
        for v in value if isinstance(value, (list, tuple)) else [value]:
            query.append((key, v))
    resp = requests.get(API.format(dataset=dataset), params=query, timeout=180)
    resp.raise_for_status()
    js = resp.json()

    dims, sizes = js["id"], js["size"]
    codes = [sorted(js["dimension"][d]["category"]["index"].items(), key=lambda kv: kv[1]) for d in dims]
    values, status = js.get("value", {}), js.get("status", {})

    rows = []
    for flat, combo in enumerate(itertools.product(*[range(s) for s in sizes])):
        key = str(flat)
        if key not in values:
            continue
        row = {d: codes[i][combo[i]][0] for i, d in enumerate(dims)}
        row["value"] = values[key]
        row["flag"] = status.get(key, "")
        rows.append(row)

    df = pd.DataFrame(rows)
    print(f"  {dataset:<14} {len(df):>6,} rows  (updated {js.get('updated', '?')[:10]})")
    return df


def save(df: pd.DataFrame, name: str) -> None:
    df.to_csv(RAW / f"{name}.csv", index=False)


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    print("Downloading from Eurostat ...")

    # Prices
    save(fetch("prc_hpi_q", geo=GEO, purchase="TOTAL", unit=["I15_Q", "RCH_A"], sinceTimePeriod="2010-Q1"), "house_price_index_q")
    save(fetch("prc_hpi_a", geo=GEO, purchase="TOTAL", unit="I15_A_AVG", sinceTimePeriod="2010"), "house_price_index_a")
    save(fetch("prc_hicp_ainr", geo=GEO, coicop18=["CP041", "TOTAL"], unit="INX_A_AVG", sinceTimePeriod="2010"), "rent_index_a")
    save(fetch("tipsho60", geo=GEO, unit=["PTIR_I15", "PTIR_LT_AVG"], sinceTimePeriod="2010"), "price_to_income")

    # Incomes (EU-SILC median equivalised net income, national currency)
    save(fetch("ilc_di03", geo=GEO, age="TOTAL", sex="T", statinfo="MED_EI", unit=["NAC", "EUR"], sinceTimePeriod="2010"), "median_income")

    # Housing stress
    save(fetch("ilc_lvho07c", geo=GEO, unit="PC", sinceTimePeriod="2010"), "overburden_by_tenure")
    save(fetch("ilc_lvho07a", geo=GEO, unit="PC", age=["TOTAL", "Y15-29"], sex="T", rskpovth=["TOTAL", "B_60"],
               sinceTimePeriod="2010"), "overburden_by_age")
    save(fetch("ilc_lvho05a", geo=GEO, unit="PC", age=["TOTAL", "Y15-29"], sex="T", rskpovth="TOTAL",
               sinceTimePeriod="2010"), "overcrowding")
    save(fetch("ilc_lvho02", geo=GEO, unit="PC", hhcomp="TOTAL", rskpovth="TOTAL", sinceTimePeriod="2010"), "tenure_status")

    # Young people
    save(fetch("yth_demo_030", geo=GEO, unit="AVG", sex="T", sinceTimePeriod="2010"), "age_leaving_home")

    # Supply
    # (quarterly permits are mostly confidential at country level -> annual series)
    save(fetch("sts_cobp_a", geo=GEO, indic_bt="BPRM_DW", cpa2_1="CPA_F41001_X_410014", s_adj="NSA",
               unit=["NR", "THS", "I15"], sinceTimePeriod="2010"), "building_permits_a")
    save(fetch("demo_gind", geo=GEO, indic_de="JAN", sinceTimePeriod="2010"), "population")

    # Map
    resp = requests.get(GISCO, timeout=180)
    resp.raise_for_status()
    (RAW / "countries_20m.geojson").write_bytes(resp.content)
    print(f"  GISCO countries {len(resp.content) / 1e6:.1f} MB")
    print(f"Done -> {RAW}")


if __name__ == "__main__":
    main()
