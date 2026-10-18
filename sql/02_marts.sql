-- =====================================================================
-- 02 · MARTS — one model per analytical question
-- =====================================================================

-- Q1 · Did housing costs outpace incomes? EU aggregate, 2015 = 100
CREATE OR REPLACE VIEW mart_eu_gap AS
WITH inc AS (
    SELECT year, 100 * income_eur / max(income_eur) FILTER (WHERE year = 2015) OVER () AS income
    FROM stg_income WHERE geo = 'EU27'
)
SELECT h.year,
       round(h.hpi, 1)                     AS house_prices,
       round(p.rent, 1)                    AS rents,
       round(p.cpi, 1)                     AS consumer_prices,
       round(i.income, 1)                  AS median_income,
       round(100 * h.hpi / p.cpi, 1)       AS real_house_prices
FROM stg_hpi_a h
JOIN stg_prices_a p USING (geo, year)
LEFT JOIN inc i USING (year)
WHERE h.geo = 'EU27' AND h.year >= 2015
ORDER BY h.year;

-- Q2 · Who carries the burden? Overburden rate by tenure, EU, over time
CREATE OR REPLACE VIEW mart_tenure_burden AS
SELECT year,
       max(pct) FILTER (WHERE tenure = 'TOTAL')    AS total,
       max(pct) FILTER (WHERE tenure = 'RENT_MKT') AS renters_market,
       max(pct) FILTER (WHERE tenure = 'RENT_FR')  AS renters_reduced,
       max(pct) FILTER (WHERE tenure = 'OWN_L')    AS owners_mortgage,
       max(pct) FILTER (WHERE tenure = 'OWN_NL')   AS owners_outright
FROM stg_overburden_tenure
WHERE geo = 'EU27'
GROUP BY year ORDER BY year;

-- Q3 · Supply response: residential permits, EU and per 1,000 inhabitants
CREATE OR REPLACE VIEW mart_permits AS
SELECT p.geo, p.year, p.dwellings, p.permits_2015,
       round(1000 * p.dwellings / pop.population, 2) AS per_1000
FROM stg_permits p
LEFT JOIN stg_population pop USING (geo, year);

-- Q4 · Country snapshot: one row per member state, latest available value of each indicator
CREATE OR REPLACE VIEW mart_country AS
WITH
countries AS (SELECT DISTINCT geo FROM stg_tenure),
hpi_latest AS (
    SELECT geo, arg_max(hpi, quarter) AS hpi_now, arg_max(hpi_yoy, quarter) AS hpi_yoy_now,
           max(quarter) AS hpi_quarter
    FROM stg_hpi_q WHERE hpi IS NOT NULL GROUP BY geo
),
hpi_2021 AS (  -- same quarter five years earlier, for medium-term momentum
    SELECT q.geo, q.hpi AS hpi_5y_ago
    FROM stg_hpi_q q JOIN hpi_latest l ON q.geo = l.geo AND q.quarter = l.hpi_quarter - INTERVAL 5 YEAR
),
rent AS (
    SELECT geo, arg_max(rent, year) - 100 AS rent_growth, arg_max(cpi, year) - 100 AS cpi_growth
    FROM stg_prices_a WHERE rent IS NOT NULL GROUP BY geo
),
income AS (
    -- Currency break guard: when a country has adopted the euro (latest NAC = EUR, e.g. Croatia 2023)
    -- the NAC series switches unit mid-way, so growth is taken from the continuous EUR series instead.
    SELECT geo,
           CASE WHEN max(income_nac) IS NULL OR arg_max(income_nac, year) = arg_max(income_eur, year)
                THEN 100 * (arg_max(income_eur, year) / max(income_eur) FILTER (WHERE year = 2015) - 1)
                ELSE 100 * (arg_max(income_nac, year) / max(income_nac) FILTER (WHERE year = 2015) - 1)
           END                       AS income_growth,
           arg_max(income_eur, year) AS income_eur
    FROM stg_income WHERE income_eur IS NOT NULL GROUP BY geo
),
ptir AS (
    SELECT geo, arg_max(ptir_2015, year) AS ptir_2015, arg_max(ptir_vs_lt_avg, year) AS ptir_vs_lt_avg,
           max(year) AS ptir_year
    FROM stg_ptir WHERE ptir_2015 IS NOT NULL GROUP BY geo
),
burden AS (
    SELECT geo,
           arg_max(pct, year) FILTER (WHERE tenure = 'TOTAL')    AS overburden_total,
           arg_max(pct, year) FILTER (WHERE tenure = 'RENT_MKT') AS overburden_renters,
           arg_max(pct, year) FILTER (WHERE tenure = 'OWN_L')    AS overburden_mortgage
    FROM stg_overburden_tenure WHERE pct IS NOT NULL GROUP BY geo
),
youth_burden AS (
    SELECT geo, arg_max(pct, year) AS overburden_youth
    FROM stg_overburden_age WHERE age = 'Y15-29' AND poverty = 'TOTAL' AND pct IS NOT NULL GROUP BY geo
),
tenure AS (
    SELECT geo,
           arg_max(pct, year) FILTER (WHERE tenure = 'OWN')      AS owner_share,
           arg_max(pct, year) FILTER (WHERE tenure = 'RENT_MKT') AS market_renter_share
    FROM stg_tenure WHERE pct IS NOT NULL GROUP BY geo
),
leaving AS (
    SELECT geo, arg_max(age_leaving, year) AS age_leaving FROM stg_age_leaving WHERE age_leaving IS NOT NULL GROUP BY geo
),
crowd AS (
    SELECT geo, arg_max(pct, year) AS overcrowding_youth
    FROM stg_overcrowding WHERE age = 'Y15-29' AND pct IS NOT NULL GROUP BY geo
),
permits AS (
    SELECT geo,
           avg(per_1000) FILTER (WHERE year BETWEEN 2023 AND 2025)                               AS permits_per_1000,
           100 * (max(dwellings) FILTER (WHERE year = 2025) / max(dwellings) FILTER (WHERE year = 2021) - 1) AS permits_vs_2021
    FROM mart_permits GROUP BY geo
)
SELECT
    k.geo,
    strftime(h.hpi_quarter, '%Y') || '-Q' || quarter(h.hpi_quarter) AS hpi_quarter,
    round(h.hpi_now - 100, 1)                     AS hpi_growth_2015,
    round(h.hpi_yoy_now, 1)                       AS hpi_yoy,
    round(100 * (h.hpi_now / f.hpi_5y_ago - 1), 1) AS hpi_growth_5y,
    round(r.rent_growth, 1)                       AS rent_growth_2015,
    round(r.cpi_growth, 1)                        AS cpi_growth_2015,
    round(i.income_growth, 1)                     AS income_growth_2015,
    i.income_eur,
    p.ptir_2015, p.ptir_vs_lt_avg, p.ptir_year,
    b.overburden_total, b.overburden_renters, b.overburden_mortgage,
    y.overburden_youth,
    t.owner_share, t.market_renter_share,
    l.age_leaving,
    c.overcrowding_youth,
    round(pm.permits_per_1000, 2)                 AS permits_per_1000,
    round(pm.permits_vs_2021, 1)                  AS permits_vs_2021
FROM countries k
LEFT JOIN hpi_latest h USING (geo)
LEFT JOIN hpi_2021 f USING (geo)
LEFT JOIN rent r USING (geo)
LEFT JOIN income i USING (geo)
LEFT JOIN ptir p USING (geo)
LEFT JOIN burden b USING (geo)
LEFT JOIN youth_burden y USING (geo)
LEFT JOIN tenure t USING (geo)
LEFT JOIN leaving l USING (geo)
LEFT JOIN crowd c USING (geo)
LEFT JOIN permits pm USING (geo)
ORDER BY k.geo;

-- Q5 · House price paths since 2015, quarterly (for the country explorer)
CREATE OR REPLACE VIEW mart_hpi_paths AS
SELECT geo, quarter_label AS quarter, round(hpi, 1) AS hpi
FROM stg_hpi_q
WHERE quarter >= DATE '2015-01-01' AND hpi IS NOT NULL
ORDER BY geo, quarter;

-- Q6 · Young adults: age of leaving home, EU vs extremes over time
CREATE OR REPLACE VIEW mart_age_leaving AS
SELECT geo, year, age_leaving FROM stg_age_leaving WHERE year >= 2015 AND age_leaving IS NOT NULL;

-- QA · Coverage report: how many member states have each indicator
CREATE OR REPLACE VIEW qa_coverage AS
UNPIVOT (
    SELECT count(hpi_growth_2015) AS hpi_growth_2015, count(rent_growth_2015) AS rent_growth_2015,
           count(income_growth_2015) AS income_growth_2015, count(ptir_vs_lt_avg) AS ptir_vs_lt_avg,
           count(overburden_total) AS overburden_total, count(overburden_renters) AS overburden_renters,
           count(overburden_youth) AS overburden_youth, count(owner_share) AS owner_share,
           count(age_leaving) AS age_leaving, count(permits_per_1000) AS permits_per_1000,
           count(permits_vs_2021) AS permits_vs_2021
    FROM mart_country WHERE geo <> 'EU27'
) ON COLUMNS(*) INTO NAME indicator VALUE countries_covered;
