"""
Step 2 — Load, model, analyse, export.

  1. Loads data/raw/*.csv into DuckDB and runs the SQL models in sql/.
  2. Builds the Housing Stress Index (5 pillars, z-scores, equal weights)
     and tests how sensitive the ranking is to each pillar.
  3. Segments the 27 member states into housing-market archetypes
     (k-means on standardised indicators, k chosen by silhouette,
     cross-checked against Ward hierarchical clustering).
  4. Exports tidy CSVs to data/processed/ and the report payload to report/data.json.

Run:  python src/build_dataset.py
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from sklearn.cluster import AgglomerativeClustering, KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
RAW, PROCESSED, SQL, REPORT = ROOT / "data" / "raw", ROOT / "data" / "processed", ROOT / "sql", ROOT / "report"
SEED = 42

COUNTRY = {
    "AT": "Austria", "BE": "Belgium", "BG": "Bulgaria", "CY": "Cyprus", "CZ": "Czechia", "DE": "Germany",
    "DK": "Denmark", "EE": "Estonia", "EL": "Greece", "ES": "Spain", "FI": "Finland", "FR": "France",
    "HR": "Croatia", "HU": "Hungary", "IE": "Ireland", "IT": "Italy", "LT": "Lithuania", "LU": "Luxembourg",
    "LV": "Latvia", "MT": "Malta", "NL": "Netherlands", "PL": "Poland", "PT": "Portugal", "RO": "Romania",
    "SE": "Sweden", "SI": "Slovenia", "SK": "Slovakia", "EU27": "EU-27",
}

# Housing Stress Index: pillar -> (indicators, direction: +1 = higher means more stress)
PILLARS = {
    "Affordability erosion": [("ptir_2015", +1)],          # price-to-income vs 2015
    "Overvaluation":         [("ptir_vs_lt_avg", +1)],     # price-to-income vs long-term average
    "Renter burden":         [("overburden_renters", +1)], # market renters spending >40% on housing
    "Youth lock-out":        [("age_leaving", +1), ("overburden_youth", +1)],
    "Supply shortfall":      [("permits_per_1000", -1)],   # fewer new dwellings per capita
}
# z-scores are winsorised at ±2.5 so one extreme market (e.g. Malta's permits) cannot dominate a pillar

# Segmentation features (structural market characteristics)
SEGMENT_FEATURES = ["ptir_2015", "ptir_vs_lt_avg", "hpi_growth_5y", "overburden_renters", "owner_share",
                    "age_leaving", "overcrowding_youth", "permits_per_1000", "income_eur"]


def zscore(s: pd.Series, clip: float | None = None) -> pd.Series:
    z = (s - s.mean()) / s.std(ddof=0)
    return z.clip(-clip, clip) if clip else z


def stress_index(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    pillars = pd.DataFrame(index=df.index)
    for name, parts in PILLARS.items():
        pillars[name] = pd.concat([sign * zscore(df[col], clip=2.5) for col, sign in parts], axis=1).mean(axis=1)
    score = pillars.mean(axis=1)
    # Sensitivity: Spearman correlation of the full ranking vs. each leave-one-pillar-out ranking
    loo = {p: round(float(score.rank().corr(pillars.drop(columns=p).mean(axis=1).rank())), 3) for p in pillars}
    out = pillars.round(3)
    out["score"] = score.round(3)
    out["rank"] = score.rank(ascending=False).astype(int)
    return out.sort_values("rank"), loo


def segment(df: pd.DataFrame) -> tuple[pd.Series, dict]:
    X = df[SEGMENT_FEATURES].copy()
    imputed = {c: [g for g in X.index[X[c].isna()]] for c in X if X[c].isna().any()}
    X = X.fillna(X.median())
    Z = StandardScaler().fit_transform(X)

    sil = {k: round(float(silhouette_score(Z, KMeans(k, n_init=100, random_state=SEED).fit_predict(Z))), 3)
           for k in range(2, 7)}
    k = max(sil, key=sil.get)
    km = KMeans(k, n_init=100, random_state=SEED).fit(Z)
    ward = AgglomerativeClustering(n_clusters=k, linkage="ward").fit_predict(Z)
    pca = PCA(2, random_state=SEED).fit(Z)
    coords = pca.transform(Z)

    # Name clusters from their centroids (deterministic, independent of k-means label order)
    centroids = pd.DataFrame(km.cluster_centers_, columns=SEGMENT_FEATURES)
    names: dict[int, str] = {}
    names[int(centroids["income_eur"].idxmax())] = "Mature rental markets"
    names[int(centroids["income_eur"].idxmin())] = "Low-income owner societies"
    rest = [c for c in centroids.index if c not in names]
    if len(rest) >= 2:
        names[int(centroids.loc[rest, "permits_per_1000"].idxmax())] = "Island construction booms"
        rest = [c for c in rest if c not in names]
    for c in rest:
        names[int(c)] = "Catch-up boom markets"

    labels = pd.Series([names[int(c)] for c in km.labels_], index=df.index, name="segment")
    meta = {
        "k": k, "silhouette_by_k": sil, "ari_vs_ward": round(float(adjusted_rand_score(km.labels_, ward)), 3),
        "pca_explained": [round(float(v), 3) for v in pca.explained_variance_ratio_],
        "pca_loadings": {f: [round(float(a), 3), round(float(b), 3)] for f, a, b in zip(SEGMENT_FEATURES, *pca.components_)},
        "imputed_with_median": imputed,
        "coords": {g: [round(float(x), 3), round(float(y), 3)] for g, (x, y) in zip(df.index, coords)},
    }
    return labels, meta


def records(df: pd.DataFrame) -> list[dict]:
    df = df.astype(object).where(df.notna(), None)
    return df.to_dict(orient="records")


def main() -> None:
    PROCESSED.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(ROOT / "data" / "housing.duckdb"))
    for csv in sorted(RAW.glob("*.csv")):
        con.execute(f"CREATE OR REPLACE TABLE raw_{csv.stem} AS "
                    f"SELECT * FROM read_csv_auto('{csv.as_posix()}', all_varchar=true)")
    for sql_file in sorted(SQL.glob("*.sql")):
        con.execute(sql_file.read_text(encoding="utf-8"))

    country = con.sql("SELECT * FROM mart_country").df().set_index("geo")
    eu = country.loc["EU27"]
    members = country.drop(index="EU27")

    hsi, loo = stress_index(members)
    seg, seg_meta = segment(members)
    members = members.join(hsi[["score", "rank"]].rename(columns={"score": "stress_score", "rank": "stress_rank"})).join(seg)

    seg_profile = (members.groupby("segment")[SEGMENT_FEATURES + ["hpi_growth_2015", "stress_score"]]
                   .median().round(1).reset_index())
    seg_profile["members"] = seg_profile["segment"].map(members.groupby("segment").apply(lambda g: sorted(g.index)).to_dict())

    # exports
    for view in ["mart_eu_gap", "mart_tenure_burden", "mart_permits", "mart_hpi_paths", "mart_age_leaving", "qa_coverage"]:
        con.sql(f"SELECT * FROM {view}").write_csv(str(PROCESSED / f"{view.removeprefix('mart_')}.csv"))
    members.reset_index().to_csv(PROCESSED / "country_snapshot.csv", index=False)
    hsi.reset_index().to_csv(PROCESSED / "housing_stress_index.csv", index=False)

    gap = con.sql("SELECT * FROM mart_eu_gap").df()
    burden = con.sql("SELECT * FROM mart_tenure_burden WHERE year >= 2015").df()
    permits_eu = con.sql("SELECT year, dwellings, per_1000 FROM mart_permits WHERE geo = 'EU27' AND year >= 2015 ORDER BY year").df()
    paths = con.sql("SELECT * FROM mart_hpi_paths").df()
    leaving = con.sql("SELECT * FROM mart_age_leaving").df()
    latest_q = con.sql("SELECT max(quarter_label) FROM stg_hpi_q WHERE geo = 'EU27' AND hpi IS NOT NULL").fetchone()[0]

    payload = {
        "meta": {
            "generated": date.today().isoformat(),
            "hpi_latest_quarter": latest_q,
            "source": "Eurostat (prc_hpi_q, prc_hpi_a, prc_hicp_ainr, tipsho60, ilc_di03, ilc_lvho07a/c, "
                      "ilc_lvho05a, ilc_lvho02, yth_demo_030, sts_cobp_a, demo_gind); GISCO boundaries",
            "stress_index": {"pillars": {k: [c for c, _ in v] for k, v in PILLARS.items()}, "leave_one_out_spearman": loo},
            "segmentation": {k: v for k, v in seg_meta.items() if k != "coords"},
            "coverage": records(con.sql("SELECT * FROM qa_coverage").df()),
        },
        "countries": COUNTRY,
        "eu": {k: (None if pd.isna(v) else v) for k, v in eu.items()},
        "members": records(members.reset_index()),
        "stress": records(hsi.reset_index()),
        "segments": records(seg_profile),
        "pca": seg_meta["coords"],
        "gap": records(gap),
        "burden": records(burden),
        "permits_eu": records(permits_eu),
        "hpi_paths": {g: grp[["quarter", "hpi"]].values.tolist() for g, grp in paths.groupby("geo")},
        "age_leaving": {g: grp[["year", "age_leaving"]].values.tolist() for g, grp in leaving.groupby("geo")},
    }
    (REPORT / "data.json").write_text(json.dumps(payload, ensure_ascii=False, default=float), encoding="utf-8")

    print(f"HPI latest quarter: {latest_q}")
    print(f"Segments: k={seg_meta['k']} silhouette={seg_meta['silhouette_by_k']} ARI vs Ward={seg_meta['ari_vs_ward']}")
    print(members.groupby("segment").apply(lambda g: " ".join(sorted(g.index))).to_string())
    print("Stress top 5:", ", ".join(hsi.index[:5]), "| LOO Spearman:", loo)


if __name__ == "__main__":
    main()
