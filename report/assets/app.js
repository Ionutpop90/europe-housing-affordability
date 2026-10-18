import {
  fmt, fmtSigned, lineChart, hBarChart, heatmap, legend, dataTable, sparkline, divergingColor,
  sequentialScale, divergingScale, choropleth, scatter, columnChart,
} from "./charts.js";

const $ = (s, r = document) => r.querySelector(s);
const bind = (key, text) => document.querySelectorAll(`[data-k="${key}"]`).forEach((n) => (n.textContent = text));
const pct = (v, d = 1) => `${fmt(v, d)}%`;
const spct = (v, d = 1) => `${fmtSigned(v, d)}%`;
const details = (id) => $(`#${id}`).closest(".card").querySelector("details.data");

const [D, MAP] = await Promise.all([fetch("data.json").then((r) => r.json()), fetch("map.json").then((r) => r.json())]);
const NAME = D.countries;
const EU = D.eu;
const M = Object.fromEntries(D.members.map((r) => [r.geo, r]));
const members = D.members;
const lastOf = (arr) => arr[arr.length - 1];

/* ---------------- Segments ---------------- */
const SEG = {
  "Mature rental markets": {
    color: "--s1",
    text: "<b>Lever:</b> keep rental supply growing in big cities. Faster permitting and protecting affordable rentals matter more than ownership subsidies.",
  },
  "Catch-up boom markets": {
    color: "--s2",
    text: "<b>Lever:</b> create entry points. Build entry-level homes and a real rental market so young adults can move out before they can afford to buy.",
  },
  "Low-income owner societies": {
    color: "--s3",
    text: "<b>Lever:</b> focus on quality, not price. Tackle overcrowding and offer social rental options for low-income households outside ownership.",
  },
  "Island construction booms": {
    color: "--seg-other",
    text: "<b>Lever:</b> make sure the building boom houses residents, through rules on short-term rentals and non-resident demand.",
  },
};
const SEG_ORDER = Object.keys(SEG);
const segColor = (geo) => SEG[M[geo].segment].color;

/* ---------------- Correlation helper ---------------- */
function pearson(pairs) {
  const n = pairs.length, mx = pairs.reduce((a, p) => a + p[0], 0) / n, my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  const b = sxy / sxx;
  return { r: sxy / Math.sqrt(sxx * syy), a: my - b * mx, b, n };
}
const corr = (kx, ky) => pearson(members.filter((r) => r[kx] != null && r[ky] != null).map((r) => [r[kx], r[ky]]));

/* ---------------- Text bindings ---------------- */
const burden = D.burden;
const b0 = burden[0], bN = lastOf(burden);
const gapN = lastOf(D.gap);
const permitsN = lastOf(D.permits_eu);
const byAge = [...members].sort((a, b) => a.age_leaving - b.age_leaving);
const byHpi = members.filter((r) => r.hpi_growth_2015 != null).sort((a, b) => a.hpi_growth_2015 - b.hpi_growth_2015);
const stressTop = D.stress[0];
const seg = D.meta.segmentation;

bind("hpiQuarter", D.meta.hpi_latest_quarter.replace("-", " ")); bind("hpiQuarter2", D.meta.hpi_latest_quarter.replace("-", " "));
bind("hpiEu", spct(EU.hpi_growth_2015)); bind("hpiEu2", spct(EU.hpi_growth_2015));
bind("incomeEu", spct(EU.income_growth_2015)); bind("incomeEu2", spct(EU.income_growth_2015));
bind("rentsEu", spct(gapN.rents - 100));
bind("realHpi", spct(gapN.real_house_prices - 100));
bind("rentersBurden", pct(bN.renters_market)); bind("ownersBurden", pct(bN.owners_outright));
bind("burdenMultiple", `${fmt(bN.renters_market / bN.owners_outright)}×`);
bind("burdenMultiple2", `${fmt(bN.renters_market / bN.owners_outright)} times`);
bind("burden2015", pct(b0.total)); bind("burdenNow", pct(bN.total));
bind("permitsChange", spct(EU.permits_vs_2021));
bind("permits2025", `${fmt(permitsN.dwellings / 1e6, 2)} million`);
bind("ageEu", fmt(EU.age_leaving)); bind("ageEu2", fmt(EU.age_leaving));
bind("ageMin", `${fmt(byAge[0].age_leaving)} in ${NAME[byAge[0].geo]}`);
bind("ageMax", `${fmt(lastOf(byAge).age_leaving)} in ${NAME[lastOf(byAge).geo]}`);
bind("topStress", NAME[stressTop.geo]);
bind("hpiMinName", NAME[byHpi[0].geo]); bind("hpiMin", spct(byHpi[0].hpi_growth_2015, 0));
bind("hpiMaxName", NAME[lastOf(byHpi).geo]); bind("hpiMax", spct(lastOf(byHpi).hpi_growth_2015, 0));
bind("k", seg.k); bind("ari", fmt(seg.ari_vs_ward, 2));
bind("pcaVar", pct((seg.pca_explained[0] + seg.pca_explained[1]) * 100, 0));
bind("looMin", fmt(Math.min(...Object.values(D.meta.stress_index.leave_one_out_spearman)), 2));
bind("rAgeRent", fmt(corr("age_leaving", "market_renter_share").r, 2));
bind("rAgeHpi", fmt(corr("age_leaving", "hpi_growth_5y").r, 2));
bind("rAgePtir", fmt(corr("age_leaving", "ptir_2015").r, 2));

/* ---------------- Render registry ---------------- */
const renderers = [];
const register = (fn) => { renderers.push(fn); fn(); };
const narrow = (id) => $(id).clientWidth < 560;

// hero sparkline
register(() => sparkline($("#spark"), D.hpi_paths.EU27.map((r) => r[1]), { ref: 100 }));

/* 01 · gap */
const GAP = [
  { key: "house_prices", label: "House prices", short: "Prices", color: "--s1" },
  { key: "median_income", label: "Median income", short: "Income", color: "--s2" },
  { key: "consumer_prices", label: "Consumer prices", short: "CPI", color: "--s3" },
  { key: "rents", label: "Rents (HICP)", short: "Rents", color: "--s4" },
];
legend($("#legendGap"), GAP.map((s) => ({ label: s.label, color: `var(${s.color})` })));
register(() => lineChart($("#chartGap"), {
  data: D.gap, xKey: "year", series: GAP, height: narrow("#chartGap") ? 320 : 380, includeZero: false,
  yFormat: (v) => fmt(v, 0), tipFormat: (v) => fmt(v, 1), refY: { value: 100, label: "2015 = 100" },
  annotations: [{ x: 2022, label: "2022: interest rates rise", short: "Rates rise" }],
  ariaLabel: "EU-27 house prices, median income, consumer prices and rents indexed to 2015",
}));
dataTable(details("chartGap"), ["Year", "House prices", "Median income", "Consumer prices", "Rents", "Real house prices"],
  D.gap.map((r) => [r.year, fmt(r.house_prices), fmt(r.median_income), fmt(r.consumer_prices), fmt(r.rents), fmt(r.real_house_prices)]));

/* 02 · map explorer */
const METRICS = [
  { key: "hpi_growth_2015", label: "House prices since 2015", type: "seq", fmt: (v) => spct(v, 0),
    desc: `Change in the house price index, 2015 to ${D.meta.hpi_latest_quarter.replace("-", " ")}.` },
  { key: "hpi_growth_5y", label: "Prices, last 5 years", type: "seq", fmt: (v) => spct(v, 0),
    desc: "Change in the house price index over the last five years." },
  { key: "ptir_vs_lt_avg", label: "Price-to-income vs history", type: "seq", fmt: (v) => fmt(v, 0),
    desc: "Standardised house price-to-income ratio, 100 = the country’s own long-term average. Above 100 means stretched." },
  { key: "overburden_renters", label: "Renters overburdened", type: "seq", fmt: (v) => pct(v),
    desc: "Share of market-rate tenants spending more than 40% of disposable income on housing." },
  { key: "age_leaving", label: "Age of leaving home", type: "seq", fmt: (v) => fmt(v),
    desc: "Estimated average age at which young people leave the parental household." },
  { key: "stress_score", label: "Housing Stress Index", type: "div", fmt: (v) => fmtSigned(v, 2),
    desc: "Composite of five pillars (chapter 06). 0 = EU average, red = more stress." },
  { key: "segment", label: "Market archetype", type: "cat", fmt: (v) => v,
    desc: "Result of the clustering model (chapter 07)." },
];
let metric = METRICS[0];
const chipBox = $("#metricChips");
for (const mt of METRICS) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "chip"; b.setAttribute("role", "radio");
  b.setAttribute("aria-checked", String(mt === metric)); b.textContent = mt.label;
  b.addEventListener("click", () => {
    metric = mt; chipBox.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-checked", String(c === b)));
    renderMap();
  });
  chipBox.appendChild(b);
}
function renderMap() {
  const values = Object.fromEntries(members.map((r) => [r.geo, r[metric.key]]));
  $("#mapTitle").textContent = metric.label;
  $("#mapDesc").textContent = metric.desc;
  let color, legendItems;
  if (metric.type === "seq") {
    const sc = sequentialScale(Object.values(values));
    color = sc.color;
    legendItems = sc.legend.map((l) => ({ color: l.color, text: `${metric.fmt(l.lo)} – ${metric.fmt(l.hi)}` }));
  } else if (metric.type === "div") {
    color = divergingScale(1.2).color;
    legendItems = [-1, -0.5, 0, 0.5, 1].map((v) => ({ color: color(v), text: fmtSigned(v, 1) }));
  } else {
    color = (v) => (v ? `var(${SEG[v].color})` : "var(--map-missing)");
    legendItems = SEG_ORDER.map((s) => ({ color: `var(${SEG[s].color})`, text: s }));
  }
  if (Object.values(values).some((v) => v == null)) legendItems.push({ color: "var(--map-missing)", text: "no data" });
  const ranked = members.filter((r) => r[metric.key] != null && metric.type !== "cat")
    .sort((a, b) => b[metric.key] - a[metric.key]);
  const rankOf = (g) => ranked.findIndex((r) => r.geo === g) + 1;
  choropleth($("#chartMap"), {
    map: MAP, values, color, names: NAME, metricLabel: metric.type === "cat" ? "archetype" : metric.label,
    valueFormat: metric.fmt, rankOf: metric.type === "cat" ? null : rankOf,
    extra: metric.type === "cat" ? null : (g) => [{ value: M[g].segment, label: "" }],
    ariaLabel: `Map of the EU: ${metric.label}`,
  });
  const lg = $("#mapLegend"); lg.replaceChildren();
  for (const it of legendItems) {
    const s = document.createElement("span"); const i = document.createElement("i");
    i.style.background = it.color; s.append(i, document.createTextNode(it.text)); lg.appendChild(s);
  }
  // ranking panel
  const panel = $("#chartMapRank");
  if (metric.type === "cat") {
    $("#rankDesc").textContent = "Members of each archetype.";
    panel.replaceChildren();
    for (const s of SEG_ORDER) {
      const row = document.createElement("div"); row.className = "seg-list";
      const h = document.createElement("div"); h.className = "seg-head";
      const i = document.createElement("i"); i.style.background = `var(${SEG[s].color})`;
      const t = document.createElement("strong"); t.textContent = s;
      h.append(i, t);
      const p = document.createElement("p"); p.textContent = members.filter((r) => r.segment === s).map((r) => NAME[r.geo]).sort().join(", ");
      row.append(h, p); panel.appendChild(row);
    }
  } else {
    $("#rankDesc").textContent = "All member states with data, highest first. Bar colour matches the map.";
    hBarChart(panel, {
      rows: ranked.map((r) => ({ label: NAME[r.geo], value: r[metric.key], color: color(r[metric.key]), tipLabel: metric.label })),
      refLine: EU[metric.key] != null && metric.type === "seq" ? { value: EU[metric.key], label: `EU ${metric.fmt(EU[metric.key])}` } : null,
      valueFormat: metric.fmt, rowH: 20, ariaLabel: `Ranking: ${metric.label}`,
    });
  }
}
register(renderMap);
dataTable(details("chartMap"), ["Country", ...METRICS.map((m) => m.label)],
  [...members].sort((a, b) => NAME[a.geo].localeCompare(NAME[b.geo])).map((r) => [NAME[r.geo], ...METRICS.map((m) => (r[m.key] == null ? "n/a" : m.fmt(r[m.key])))]));

/* 03 · who pays */
const TEN = [
  { key: "renters_market", label: "Tenants, market rent", short: "Market rent", color: "--s1" },
  { key: "renters_reduced", label: "Tenants, reduced rent", short: "Reduced rent", color: "--s2" },
  { key: "owners_mortgage", label: "Owners with mortgage", short: "Mortgage", color: "--s3" },
  { key: "owners_outright", label: "Owners, no mortgage", short: "Outright", color: "--s4" },
];
legend($("#legendTenure"), TEN.map((s) => ({ label: s.label, color: `var(${s.color})` })));
register(() => lineChart($("#chartTenure"), {
  data: burden, xKey: "year", series: TEN, height: 340, tipFormat: (v) => pct(v),
  ariaLabel: "EU housing cost overburden rate by tenure status",
}));
dataTable(details("chartTenure"), ["Year", "All", ...TEN.map((s) => s.label)],
  burden.map((r) => [r.year, pct(r.total), ...TEN.map((s) => pct(r[s.key]))]));

const renters = members.filter((r) => r.overburden_renters != null).sort((a, b) => b.overburden_renters - a.overburden_renters);
register(() => hBarChart($("#chartRenters"), {
  rows: renters.map((r) => ({ label: NAME[r.geo], value: r.overburden_renters, highlight: true, tipLabel: "market renters overburdened",
    extra: [{ value: pct(r.market_renter_share), label: "of people rent at market price" }] })),
  refLine: { value: EU.overburden_renters, label: `EU ${pct(EU.overburden_renters)}` }, valueFormat: (v) => pct(v), rowH: 20,
  ariaLabel: "Market renters overburdened by housing costs, by country",
}));
dataTable(details("chartRenters"), ["Country", "Market renters overburdened", "Share renting at market price"],
  renters.map((r) => [NAME[r.geo], pct(r.overburden_renters), pct(r.market_renter_share)]));

/* 04 · young adults */
const ageRows = [...members].sort((a, b) => b.age_leaving - a.age_leaving);
register(() => hBarChart($("#chartAge"), {
  rows: ageRows.map((r) => ({ label: NAME[r.geo], value: r.age_leaving, highlight: true, tipLabel: "years",
    extra: [{ value: pct(r.owner_share), label: "own their home" }] })),
  refLine: { value: EU.age_leaving, label: `EU ${fmt(EU.age_leaving)}` }, valueFormat: (v) => fmt(v), rowH: 20,
  ariaLabel: "Average age of leaving the parental home, by country",
}));
dataTable(details("chartAge"), ["Country", "Age of leaving home", "Owner share"], ageRows.map((r) => [NAME[r.geo], fmt(r.age_leaving), pct(r.owner_share)]));

/* 05 · supply */
const pe = D.permits_eu;
const peak = pe.reduce((a, b) => (b.dwellings > a.dwellings ? b : a));
register(() => columnChart($("#chartPermits"), {
  rows: pe.map((r) => ({ label: narrow("#chartPermits") ? `’${String(r.year).slice(2)}` : r.year, value: r.dwellings / 1000,
    highlight: r.year === peak.year || r === lastOf(pe), extra: [{ value: fmt(r.per_1000, 2), label: "per 1,000 residents" }] })),
  valueFormat: (v) => `${fmt(v, 0)}k`, labelIdx: [pe.indexOf(peak), pe.length - 1], tipLabel: "dwellings permitted", height: 400,
  ariaLabel: "EU-27 residential building permits per year",
}));
dataTable(details("chartPermits"), ["Year", "Dwellings permitted", "Per 1,000 residents"],
  pe.map((r) => [r.year, Math.round(r.dwellings).toLocaleString("en-GB"), fmt(r.per_1000, 2)]));

const segLegend = SEG_ORDER.map((s) => ({ label: s, color: `var(${SEG[s].color})` }));
legend($("#legendScatter"), segLegend, "dot");
legend($("#legendPca"), segLegend, "dot");
const sc = members.filter((r) => r.permits_per_1000 != null && r.hpi_growth_5y != null);
const fit = pearson(sc.map((r) => [r.permits_per_1000, r.hpi_growth_5y]));
bind("scatterR", fmt(fit.r, 2)); bind("scatterN", fit.n);
register(() => scatter($("#chartScatter"), {
  points: sc.map((r) => ({ x: r.permits_per_1000, y: r.hpi_growth_5y, label: r.geo, name: NAME[r.geo], color: segColor(r.geo),
    extra: [{ value: r.segment, label: "" }] })),
  xLabel: "Permits per 1,000 residents", yLabel: "House prices, 5-year change (%)",
  xFmt: (v) => fmt(v, 0), yFmt: (v) => `${fmt(v, 0)}`, refX: EU.permits_per_1000, trend: [fit.a, fit.b], height: 400,
  ariaLabel: "Scatter plot of building permits per capita against five-year house price growth",
}));
dataTable(details("chartScatter"), ["Country", "Permits per 1,000", "Price change, 5 years", "Archetype"],
  sc.map((r) => [NAME[r.geo], fmt(r.permits_per_1000, 2), spct(r.hpi_growth_5y), r.segment]));

/* 06 · stress index */
const PILLARS = Object.keys(D.meta.stress_index.pillars);
const PSHORT = { "Affordability erosion": "AE", "Overvaluation": "OV", "Renter burden": "RB", "Youth lock-out": "YL", "Supply shortfall": "SS" };
const cols = [...PILLARS, "score"];
const stressIdx = Object.fromEntries(D.stress.map((r) => [r.geo, r]));
const renderIndex = () => {
  heatmap($("#chartIndex"), {
    rows: D.stress.map((r) => ({ key: r.geo, label: `${r.rank}. ${NAME[r.geo]}`, short: `${r.rank}. ${r.geo}`, emphasis: r.rank <= 3 })),
    cols, cap: 2, get: (g, c) => stressIdx[g][c], cellFormat: (v) => fmtSigned(v, 1), tipLabel: "z-score (0 = EU average)",
    colLabel: (c, n) => (c === "score" ? (n ? "Σ" : "Overall") : n ? PSHORT[c] : c), colName: (c) => (c === "score" ? "Overall score" : c),
    ariaLabel: "Housing Stress Index heatmap by country and pillar",
  });
  const stops = [-2, -1, 0, 1, 2].map((v, i) => `${divergingColor(v, 2).fill} ${i * 25}%`);
  $("#indexScale").style.background = `linear-gradient(90deg, ${stops.join(",")})`;
};
register(renderIndex);
dataTable(details("chartIndex"), ["Rank", "Country", ...PILLARS, "Score"],
  D.stress.map((r) => [r.rank, NAME[r.geo], ...PILLARS.map((p) => fmtSigned(r[p], 2)), fmtSigned(r.score, 2)]));

/* 07 · segments */
const cards = $("#segmentCards");
const segProfile = Object.fromEntries(D.segments.map((s) => [s.segment, s]));
for (const s of SEG_ORDER) {
  const p = segProfile[s]; if (!p) continue;
  const el = document.createElement("article"); el.className = "seg";
  const head = document.createElement("div"); head.className = "seg-head";
  const dot = document.createElement("i"); dot.style.background = `var(${SEG[s].color})`;
  const h = document.createElement("h3"); h.textContent = s;
  head.append(dot, h);
  const mem = document.createElement("div"); mem.className = "members"; mem.textContent = p.members.map((g) => NAME[g]).join(", ");
  const dl = document.createElement("dl");
  const stats = [
    ["Prices since 2015", spct(p.hpi_growth_2015, 0)], ["Prices, last 5 years", spct(p.hpi_growth_5y, 0)],
    ["Own their home", pct(p.owner_share, 0)], ["Age leaving home", fmt(p.age_leaving)],
    ["Renters overburdened", pct(p.overburden_renters, 0)], ["Permits per 1,000", fmt(p.permits_per_1000)],
    ["Median income", `€${Math.round(p.income_eur).toLocaleString("en-GB")}`],
  ];
  for (const [k, v] of stats) { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); }
  const txt = document.createElement("p"); txt.innerHTML = SEG[s].text; // static, author-written copy
  el.append(head, mem, dl, txt); cards.appendChild(el);
}
register(() => scatter($("#chartPca"), {
  points: members.map((r) => ({ x: D.pca[r.geo][0], y: D.pca[r.geo][1], label: r.geo, name: NAME[r.geo], color: segColor(r.geo),
    extra: [{ value: r.segment, label: "" }] })),
  xLabel: "Principal component 1", yLabel: "Principal component 2", xFmt: (v) => fmt(v, 1), yFmt: (v) => fmt(v, 1), height: 440,
  ariaLabel: "PCA projection of the 27 housing markets coloured by archetype",
}));
dataTable(details("chartPca"), ["Country", "Archetype", "PC1", "PC2", "Stress rank"],
  members.map((r) => [NAME[r.geo], r.segment, fmt(D.pca[r.geo][0], 2), fmt(D.pca[r.geo][1], 2), r.stress_rank]));

/* ---------------- Re-render on resize & theme ---------------- */
let raf, lastW = window.innerWidth;
window.addEventListener("resize", () => {
  if (window.innerWidth === lastW) return; lastW = window.innerWidth;
  cancelAnimationFrame(raf); raf = requestAnimationFrame(() => renderers.forEach((f) => f()));
});
const rethemed = () => { renderMap(); renderIndex(); };
$("#theme").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch (e) {}
  rethemed();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rethemed);
