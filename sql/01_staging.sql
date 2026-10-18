-- =====================================================================
-- 01 · STAGING — typed, renamed views over the raw Eurostat extracts
--      Convention: geo 'EU27_2020' → 'EU27'; years as INT; values as DOUBLE
-- =====================================================================

CREATE OR REPLACE MACRO geo_clean(g) AS CASE g WHEN 'EU27_2020' THEN 'EU27' ELSE g END;

-- House price index, quarterly (2015 = 100) and annual rate
CREATE OR REPLACE VIEW stg_hpi_q AS
SELECT geo_clean(geo)                                                   AS geo,
       make_date(left(time, 4)::INT, (right(time, 1)::INT - 1) * 3 + 1, 1) AS quarter,
       time                                                             AS quarter_label,
       max(value::DOUBLE) FILTER (WHERE unit = 'I15_Q')                 AS hpi,
       max(value::DOUBLE) FILTER (WHERE unit = 'RCH_A')                 AS hpi_yoy
FROM raw_house_price_index_q
GROUP BY ALL;

CREATE OR REPLACE VIEW stg_hpi_a AS
SELECT geo_clean(geo) AS geo, time::INT AS year, value::DOUBLE AS hpi
FROM raw_house_price_index_a;

-- HICP: actual rents (CP041) and all items, rebased from 2025=100 to 2015=100
CREATE OR REPLACE VIEW stg_prices_a AS
WITH x AS (
    SELECT geo_clean(geo) AS geo, time::INT AS year,
           max(value::DOUBLE) FILTER (WHERE coicop18 = 'CP041') AS rent_raw,
           max(value::DOUBLE) FILTER (WHERE coicop18 = 'TOTAL') AS cpi_raw
    FROM raw_rent_index_a GROUP BY ALL
)
SELECT geo, year,
       100 * rent_raw / max(rent_raw) FILTER (WHERE year = 2015) OVER (PARTITION BY geo) AS rent,
       100 * cpi_raw  / max(cpi_raw)  FILTER (WHERE year = 2015) OVER (PARTITION BY geo) AS cpi
FROM x;

-- Median equivalised net income (EU-SILC); NAC for growth, EUR for levels
CREATE OR REPLACE VIEW stg_income AS
SELECT geo_clean(geo) AS geo, time::INT AS year,
       max(value::DOUBLE) FILTER (WHERE unit = 'NAC') AS income_nac,
       max(value::DOUBLE) FILTER (WHERE unit = 'EUR') AS income_eur
FROM raw_median_income
GROUP BY ALL;

-- Standardised house price-to-income ratio
CREATE OR REPLACE VIEW stg_ptir AS
SELECT geo_clean(geo) AS geo, time::INT AS year,
       max(value::DOUBLE) FILTER (WHERE unit = 'PTIR_I15')    AS ptir_2015,
       max(value::DOUBLE) FILTER (WHERE unit = 'PTIR_LT_AVG') AS ptir_vs_lt_avg
FROM raw_price_to_income
GROUP BY ALL;

-- Housing cost overburden (share of people spending > 40% of disposable income on housing)
CREATE OR REPLACE VIEW stg_overburden_tenure AS
SELECT geo_clean(geo) AS geo, time::INT AS year, tenure, value::DOUBLE AS pct
FROM raw_overburden_by_tenure;

CREATE OR REPLACE VIEW stg_overburden_age AS
SELECT geo_clean(geo) AS geo, time::INT AS year, age, rskpovth AS poverty, value::DOUBLE AS pct
FROM raw_overburden_by_age;

CREATE OR REPLACE VIEW stg_overcrowding AS
SELECT geo_clean(geo) AS geo, time::INT AS year, age, value::DOUBLE AS pct
FROM raw_overcrowding;

CREATE OR REPLACE VIEW stg_tenure AS
SELECT geo_clean(geo) AS geo, time::INT AS year, tenure, value::DOUBLE AS pct
FROM raw_tenure_status;

CREATE OR REPLACE VIEW stg_age_leaving AS
SELECT geo_clean(geo) AS geo, time::INT AS year, value::DOUBLE AS age_leaving
FROM raw_age_leaving_home;

-- Residential building permits (dwellings) and population
CREATE OR REPLACE VIEW stg_permits AS
SELECT geo_clean(geo) AS geo, time::INT AS year,
       max(value::DOUBLE) FILTER (WHERE unit = 'THS') * 1000 AS dwellings,
       max(value::DOUBLE) FILTER (WHERE unit = 'I15')        AS permits_2015
FROM raw_building_permits_a
GROUP BY ALL;

CREATE OR REPLACE VIEW stg_population AS
SELECT geo_clean(geo) AS geo, time::INT AS year, value::DOUBLE AS population
FROM raw_population;
