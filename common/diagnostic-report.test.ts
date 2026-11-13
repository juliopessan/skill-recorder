import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { Engagement, Initiatives, Opportunity, ProcessMap } from "./diagnostic";
import { DEFAULT_THESIS_TEXT, DIAGNOSTIC_CONFIG_VERSION } from "./diagnostic-config";
import { buildReportModel, escapeHtml, formatCurrency, formatPayback, renderReportHtml } from "./diagnostic-report";

type Fixture = { engagement: Engagement; maps: Record<string, ProcessMap>; opportunities: Opportunity[]; initiatives: Initiatives };
const load = (): Fixture =>
  JSON.parse(readFileSync(new URL("./__fixtures__/diagnostic-engagement.json", import.meta.url), "utf8")) as Fixture;

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);

test("model of a fully confirmed fixture is not a draft and totals match hand computation", () => {
  const f = load();
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW);
  assert.equal(m.draft, false);
  assert.deepEqual(m.draftReasons, []);
  assert.equal(m.generatedAt, NOW);
  assert.equal(m.configVersion, DIAGNOSTIC_CONFIG_VERSION);
  // p1: 3000 + 6000 + 3000 + 1500 ; p2: 533.33 + 1600 + 266.67
  assert.equal(m.totals.monthlyCost, 15900);
  // o1 1800 (cap .3) + o2 3000 (.5 of 6000) + o3 1493.33 (.7 of 2133.33)
  assert.equal(m.totals.monthlySavings, 6293.33);
  assert.deepEqual(m.opportunities.map((o) => o.id), ["o1", "o2", "o3"]);
});

test("quick win is only for small, prerequisite-free opportunities; wave 3 with prerequisites never", () => {
  const f = load();
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW);
  const byId = new Map(m.opportunities.map((o) => [o.id, o]));
  assert.equal(byId.get("o1")!.quickWin, true);
  assert.equal(byId.get("o2")!.quickWin, false);
  assert.equal(byId.get("o3")!.quickWin, false);
  assert.deepEqual(byId.get("o3")!.prerequisitePath.map((p) => p.id), ["o1", "o2"]);
  assert.equal(byId.get("o1")!.readiness, 100);
  const html = renderReportHtml(m, f.engagement, f.maps);
  assert.equal((html.match(/class="badge badge-quick"/g) ?? []).length, 1);
});

test("roadmap has three waves in order", () => {
  const f = load();
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW);
  assert.deepEqual(m.roadmap.map((w) => w.wave), [1, 2, 3]);
  assert.deepEqual(m.roadmap.map((w) => w.items.map((i) => i.id)), [["o1"], ["o2"], ["o3"]]);
});

test("flipping a source to ai-suggested makes the report a draft with the exact banner", () => {
  const f = load();
  f.engagement.processes[0]!.volumePerMonth = { value: 100, source: "ai-suggested" };
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW);
  assert.equal(m.draft, true);
  assert.ok(m.draftReasons.length > 0);
  const html = renderReportHtml(m, f.engagement, f.maps);
  assert.ok(html.includes("Rascunho — premissas não confirmadas"));
  assert.ok(html.includes(escapeHtml(m.draftReasons[0]!)));
  const ok = load();
  const clean = renderReportHtml(buildReportModel(ok.engagement, ok.maps, ok.opportunities, NOW), ok.engagement, ok.maps);
  assert.ok(!clean.includes("Rascunho — premissas não confirmadas"));
});

test("user strings are escaped and the output never contains a script tag", () => {
  const f = load();
  f.engagement.clientName = "<script>x</script>";
  f.opportunities[0]!.title = `<img src=x onerror="a()">`;
  f.maps.p1!.steps[0]!.title = "<b>negrito</b> & cia";
  f.engagement.thesisText = "<script>alert(1)</script>";
  f.engagement.dataQuestionnaire.governance = { answer: 1, source: "confirmed", evidence: ["<i>ev</i>"] };
  const html = renderReportHtml(buildReportModel(f.engagement, f.maps, f.opportunities, NOW), f.engagement, f.maps);
  assert.ok(html.includes("&lt;script&gt;x&lt;/script&gt;"));
  assert.ok(!/<script/i.test(html));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<b>negrito"));
  assert.ok(!html.includes("<i>ev</i>"));
});

test("html carries the config version, the thesis and omits hidden opportunities", () => {
  const f = load();
  const html = renderReportHtml(buildReportModel(f.engagement, f.maps, f.opportunities, NOW), f.engagement, f.maps);
  assert.ok(html.includes(escapeHtml(f.engagement.thesisText)));
  assert.match(html, new RegExp(`versão ${DIAGNOSTIC_CONFIG_VERSION}\\b`));
  assert.ok(!html.includes("Painel de divergências"));
  assert.ok(html.includes("Distribuidora Aurora Ltda."));
});

test("empty thesis falls back to the default text", () => {
  const f = load();
  f.engagement.thesisText = "   ";
  const html = renderReportHtml(buildReportModel(f.engagement, f.maps, f.opportunities, NOW), f.engagement, f.maps);
  assert.ok(html.includes(escapeHtml(DEFAULT_THESIS_TEXT)));
});

test("all sections render in order", () => {
  const f = load();
  const html = renderReportHtml(buildReportModel(f.engagement, f.maps, f.opportunities, NOW), f.engagement, f.maps);
  const ids = ["resumo", "antes-da-ia", "mapa", "dados", "oportunidades", "capacitacao", "roadmap", "novas-frentes", "squad", "premissas"];
  const positions = ids.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((p) => p >= 0), `missing section: ${positions.join(",")}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  for (const t of ["Onda 1", "Onda 2", "Onda 3", "0–3 meses", "3–6 meses", "6–12 meses"]) assert.ok(html.includes(t), t);
  assert.ok(html.includes("R$"));
  assert.match(html, /#00A650/i); // structured green is used
});

test("rendering is deterministic, self-contained and uses no external URLs", () => {
  const f = load();
  const a = renderReportHtml(buildReportModel(f.engagement, f.maps, f.opportunities, NOW), f.engagement, f.maps);
  const g = load();
  const b = renderReportHtml(buildReportModel(g.engagement, g.maps, g.opportunities, NOW), g.engagement, g.maps);
  assert.equal(a, b);
  assert.ok(!/https?:\/\//.test(a));
  assert.ok(!/<script/i.test(a));
  assert.ok(!/<img|<link|@import|url\(/i.test(a));
});

test("assumptions label every number with its source", () => {
  const f = load();
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW);
  assert.ok(m.assumptions.length > 0);
  for (const a of m.assumptions) assert.ok(["measured", "ai-suggested", "confirmed", "consultant"].includes(a.source));
  assert.ok(m.assumptions.some((a) => a.source === "ai-suggested"));
  assert.ok(m.assumptions.some((a) => a.source === "measured"));
});

const render = (f: Fixture): string => renderReportHtml(buildReportModel(f.engagement, f.maps, f.opportunities, NOW), f.engagement, f.maps);

test("hidden prerequisites are omitted from every path but still block the quick win", () => {
  const f = load();
  f.opportunities[0]!.prerequisites = ["o4"]; // o1 depends on the hidden o4
  f.opportunities[1]!.prerequisites = ["o1", "o4"];
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW);
  const byId = new Map(m.opportunities.map((o) => [o.id, o]));
  assert.equal(byId.get("o1")!.quickWin, false);
  assert.deepEqual(byId.get("o2")!.prerequisitePath.map((p) => p.id), ["o1"]);
  assert.ok(!render(f).includes("Painel de divergências"));
});

test("totals do not double count opportunities on the same step", () => {
  const f = load();
  f.opportunities[1]!.stepIds = ["s2"]; // o1 (wave 1, 30%) and o2 (wave 2, 50%) both on s2 (6000)
  f.opportunities[2]!.stepIds = [];
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW);
  assert.equal(m.totals.monthlySavings, 3000);
});

test("savings provenance label shows for unconfirmed percentages only, without a draft banner", () => {
  const f = load();
  const html = render(f);
  assert.ok(html.includes("estimativa sugerida pela IA, limitada por teto da onda"));
  assert.ok(!html.includes("Rascunho — premissas não confirmadas"));
  for (const o of f.opportunities) o.estimatedSavingsPct.source = "confirmed";
  assert.ok(!render(f).includes("estimativa sugerida pela IA"));
});

test("role hourly cost is attributed to the consultant", () => {
  const html = render(load());
  assert.ok(html.includes("informado pelo consultor"));
});

test("unconfirmed or missing questionnaire axes make the report a draft", () => {
  const f = load();
  delete f.engagement.dataQuestionnaire.governance;
  f.engagement.dataQuestionnaire.access!.source = "ai-suggested";
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW);
  assert.equal(m.draft, true);
  assert.equal(m.draftReasons.length, 2);
});

test("empty and zero states render without NaN, Infinity or undefined", () => {
  const bad = /NaN|Infinity|undefined|\[object/;
  const cases: Record<string, (f: Fixture) => void> = {
    "no processes": (f) => { f.engagement.processes = []; f.maps = {}; f.opportunities = []; },
    "no maps": (f) => { f.maps = {}; },
    "no opportunities": (f) => { f.opportunities = []; },
    "empty questionnaire": (f) => { f.engagement.dataQuestionnaire = {}; },
    "zero cost": (f) => { for (const r of f.engagement.roles) r.hourlyCost = 0; },
    "map without steps": (f) => { f.maps.p1!.steps = []; f.maps.p1!.variants = []; },
    "null durations": (f) => { for (const s of f.maps.p1!.steps) s.medianDurationMs = null; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const f = load();
    mutate(f);
    const html = render(f);
    assert.ok(html.startsWith("<!doctype html>"), name);
    assert.ok(!bad.test(html.replace(/<style>[\s\S]*?<\/style>/, "")), `${name}: ${html.match(bad)?.[0]}`);
  }
});

test("escaping covers aria-labels, apps, roles, owners, variants and quotes in attributes", () => {
  const f = load();
  const evil = `"><svg onload=x>`;
  f.engagement.processes[0]!.name = `Proc ${evil}`;
  f.engagement.processes[0]!.owner = `Dono ${evil}`;
  f.engagement.roles[0]!.name = `Papel ${evil}`;
  f.maps.p1!.steps[0]!.apps = [`App ${evil}`];
  f.maps.p1!.variants[0]!.description = `Var ${evil}`;
  f.opportunities[0]!.suggestedSquad.roles = [`Perfil ${evil}`];
  const html = render(f);
  assert.ok(!html.includes(`${evil}`));
  assert.ok(!html.includes("<svg onload"));
  assert.ok(html.includes("&quot;&gt;&lt;svg onload=x&gt;"));
});

test("unexpected enum-like values neither throw nor inject markup", () => {
  const f = load();
  (f.opportunities[0] as unknown as Record<string, unknown>).risk = "<b>x</b>";
  (f.opportunities[0] as unknown as Record<string, unknown>).effort = "<i>";
  (f.maps.p1!.steps[0] as unknown as Record<string, unknown>).dataStructure = "<u>";
  const html = render(f);
  assert.ok(!html.includes("<b>x"));
  assert.ok(!html.includes("<u>"));
  assert.ok(!html.includes("<i>"));
});

test("squad roles are grouped case-insensitively and generatedAt uses Sao Paulo time", () => {
  const f = load();
  f.opportunities[0]!.suggestedSquad.roles = ["Analista de Dados", " analista de dados "];
  f.opportunities[1]!.suggestedSquad.roles = ["ANALISTA DE DADOS"];
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW);
  const r = m.squad.roles.filter((x) => x.name.toLowerCase() === "analista de dados");
  assert.equal(r.length, 1);
  assert.equal(r[0]!.name, "Analista de Dados");
  const late = Date.UTC(2026, 10, 13, 1, 0, 0); // 22:00 on the 12th in Sao Paulo
  const html = renderReportHtml(buildReportModel(f.engagement, f.maps, f.opportunities, late), f.engagement, f.maps);
  assert.ok(html.includes("12 de novembro de 2026"));
});

const full = (f: Fixture, now = NOW) => buildReportModel(f.engagement, f.maps, f.opportunities, now, f.initiatives);
const fullHtml = (f: Fixture): string => renderReportHtml(full(f), f.engagement, f.maps);

test("maturity, capacitação, novas frentes and Avanade identity are in the report", () => {
  const f = load();
  const m = full(f);
  assert.equal(m.maturity.level, 2);
  assert.equal(m.maturity.name, "Exploratório");
  assert.equal(m.maturity.weakest, "dados");
  const html = fullHtml(f);
  for (const t of ["Nível 2 de 5 — Exploratório", "Capacitação", "Novas frentes no cliente", "Do what matters", "avanade.com", "#FF5800", "#DC4600"]) {
    assert.ok(html.includes(t), t);
  }
  assert.ok(!/https?:\/\//.test(html));
  assert.ok(!/<script/i.test(html));
  assert.equal((html.match(/Do what matters/g) ?? []).length, 1);
});

test("enablement and expansion never change money totals; hidden items are absent", () => {
  const f = load();
  const m = full(f);
  assert.equal(m.totals.monthlySavings, 6293.33);
  assert.equal(m.totals.monthlyCost, 15900);
  assert.deepEqual(m.enablement.map((x) => x.id), ["c1", "c2"]);
  assert.deepEqual(m.expansion.map((x) => x.id), ["x1"]);
  const html = fullHtml(f);
  assert.ok(!html.includes("Mentoria oculta"));
  assert.ok(!html.includes("Frente oculta"));
  assert.ok(html.includes("Letramento em IA para a liderança"));
  assert.ok(html.includes("Contas a pagar"));
});

test("enablement and expansion strings are escaped", () => {
  const f = load();
  f.initiatives.enablement[0]!.title = "<b>curso</b>";
  f.initiatives.enablement[0]!.audience = `"><svg onload=x>`;
  f.initiatives.expansion[0]!.area = "<i>área</i>";
  f.initiatives.expansion[0]!.evidence = ["<u>ev</u>"];
  const html = fullHtml(f);
  assert.ok(!html.includes("<b>curso"));
  assert.ok(!html.includes("<svg onload"));
  assert.ok(!html.includes("<i>área"));
  assert.ok(!html.includes("<u>ev"));
  assert.ok(html.includes("&lt;b&gt;curso&lt;/b&gt;"));
});

test("squad by wave shows n de 5 pessoas and enablement sits in Onda 1 of the roadmap", () => {
  const f = load();
  const m = full(f);
  assert.deepEqual(m.squadByWave.map((w) => [w.wave, w.count, w.max]), [[1, 1, 5], [2, 2, 5], [3, 3, 5]]);
  const html = fullHtml(f);
  assert.ok(html.includes("2 de 5 pessoas"));
  const roadmap = html.slice(html.indexOf('id="roadmap"'), html.indexOf('id="novas-frentes"'));
  const wave1 = roadmap.slice(0, roadmap.indexOf("Onda 2"));
  assert.ok(wave1.includes("Workshop de governança de dados"));
});

test("report without initiatives renders empty states and stays deterministic", () => {
  const f = load();
  const a = renderReportHtml(buildReportModel(f.engagement, f.maps, f.opportunities, NOW), f.engagement, f.maps);
  assert.ok(a.includes("Novas frentes no cliente"));
  assert.ok(!/NaN|undefined/.test(a.replace(/<style>[\s\S]*?<\/style>/, "")));
  assert.equal(fullHtml(load()), fullHtml(load()));
});

test("stale opportunities after a map regeneration make the report a draft with a banner reason", () => {
  const f = load();
  const [first] = f.opportunities;
  f.opportunities[0] = { ...first!, stepIds: [...first!.stepIds, "step-that-no-longer-exists"] };
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW);
  assert.equal(m.draft, true);
  const reason = m.draftReasons.find((r) => r.startsWith("Há oportunidades desatualizadas"));
  assert.ok(reason);
  const html = renderReportHtml(m, f.engagement, f.maps);
  assert.ok(html.includes("Rascunho — premissas não confirmadas"));
  assert.ok(html.includes(escapeHtml(reason!)));
});

// --- squad cost and return ---------------------------------------------------------------------

const renderI = (f: Fixture): string =>
  renderReportHtml(buildReportModel(f.engagement, f.maps, f.opportunities, NOW, f.initiatives), f.engagement, f.maps);
const BRL = (n: number): string => escapeHtml(formatCurrency(n, "BRL"));

test("investment and return match the hand computation on the fixture", () => {
  const f = load();
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW, f.initiatives);
  // wave 1: 2 weeks x 3000 = 6000; wave 2: 6 weeks x (4000 + 3000) = 42000; wave 3: 10 weeks x (5000 + 4000 + 3500) = 125000
  assert.deepEqual(m.squadByWave.map((w) => w.cost), [6000, 42000, 125000]);
  assert.deepEqual(m.squadByWave.map((w) => w.weeks), [2, 6, 10]);
  const inv = m.investment;
  assert.equal(inv.squadCost, 173000);
  assert.equal(inv.enablementDays, 3); // c3 is hidden
  assert.equal(inv.enablementCost, 6000); // 3 days x 2000
  assert.equal(inv.total, 179000);
  assert.deepEqual(m.opportunities.map((o) => o.investment), [6000, 42000, 125000]);
  assert.deepEqual(m.opportunities.map((o) => o.paybackMonths), [3.33, 14, 83.71]); // 6000/1800, 42000/3000, 125000/1493.33
  assert.deepEqual(m.opportunities.map((o) => o.paybackOverCap), [false, false, true]);
  assert.equal(inv.paybackMonths, 28.44); // 179000 / 6293.33
  assert.equal(inv.paybackOverCap, false);
  assert.equal(inv.deliveryMonths, 4.15); // 18 weeks / (52/12)
  // (36 - 18*12/52) x 6293.33 - 179000
  assert.equal(inv.netOver36Months, Math.round(((36 - (18 * 12) / 52) * 6293.33 - 179000) * 100) / 100);
  assert.ok(Math.abs(inv.netOver36Months! - 21418) < 2);
  assert.equal(inv.note, null);
  // totals untouched by cost
  assert.equal(m.totals.monthlyCost, 15900);
  assert.equal(m.totals.monthlySavings, 6293.33);
});

test("the report shows investment, payback and result in the summary, cards, squad table and appendix", () => {
  const f = load();
  const html = renderI(f);
  for (const t of ["Investimento do programa", "Resultado em 36 meses", "Investimento alocado", "Custo do squad", "Premissa de custo"]) {
    assert.ok(html.includes(t), t);
  }
  assert.ok(html.includes(BRL(179000)));
  assert.ok(html.includes("28,4 meses"));
  assert.ok(html.includes("&gt; 36 meses")); // o3
  for (const c of [6000, 42000, 125000, 173000]) assert.ok(html.includes(BRL(c)), String(c));
  // appendix: every rate, the day rate and the model parameters
  assert.ok(html.includes(`Tarifa semanal do perfil &quot;Engenheiro de IA&quot;`));
  assert.ok(html.includes("informado pelo consultor"));
  assert.ok(html.includes("Custo por dia de capacitação"));
  assert.ok(html.includes("Semanas por mês: 52 ÷ 12"));
  assert.ok(html.includes("pro rata"));
  assert.ok(!html.includes("Rascunho — premissas não confirmadas"));
  assert.ok(!/NaN|Infinity|undefined/.test(html));
});

test("without a rate for a visible role nothing is calculated, the report is a draft with the reason, and no NaN prints", () => {
  const f = load();
  f.engagement.squadRates = f.engagement.squadRates.filter((r) => r.role !== "Product owner");
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW, f.initiatives);
  const reason = "Tarifa do squad não informada para: Product owner — o investimento e o payback não foram calculados.";
  assert.equal(m.draft, true);
  assert.ok(m.draftReasons.includes(reason));
  assert.equal(m.investment.total, null);
  assert.equal(m.investment.paybackMonths, null);
  assert.equal(m.investment.netOver36Months, null);
  assert.equal(m.investment.note, "tarifa do squad não informada");
  assert.deepEqual(m.squadByWave.map((w) => w.cost), [6000, 42000, null]);
  assert.deepEqual(m.opportunities.map((o) => o.investment), [6000, 42000, null]);
  const html = renderI(f);
  assert.ok(html.includes("Rascunho — premissas não confirmadas"));
  assert.ok(html.includes(escapeHtml(reason)));
  assert.ok(html.includes("Não calculado"));
  assert.ok(html.includes("Sem tarifa informada: Product owner"));
  assert.ok(!/NaN|Infinity|undefined/.test(html));
});

test("an engagement with no rates at all renders without NaN and keeps the legacy totals", () => {
  const f = load();
  f.engagement.squadRates = [];
  delete f.engagement.enablementDayRate;
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW, f.initiatives);
  assert.equal(m.investment.total, null);
  assert.deepEqual(m.investment.missingRoles, ["Analista de dados", "Engenheiro de automação", "Engenheiro de IA", "Product owner"]);
  assert.equal(m.totals.monthlySavings, 6293.33);
  const html = renderI(f);
  assert.ok(!/NaN|Infinity|undefined/.test(html));
  assert.ok(!html.includes("Custo por dia de capacitação"));
});

test("no savings means payback and result are not shown but the investment is", () => {
  const f = load();
  f.opportunities.forEach((o) => { o.stepIds = []; });
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW, f.initiatives);
  assert.equal(m.totals.monthlySavings, 0);
  assert.equal(m.investment.total, 179000);
  assert.equal(m.investment.paybackMonths, null);
  assert.equal(m.investment.note, "sem economia mensal calculada");
  assert.equal(m.investment.netOver36Months, -179000 + 0);
  assert.ok(!/NaN|Infinity|undefined/.test(renderI(f)));
});

test("a payback beyond 36 months shows as > 36 meses and rate text is escaped", () => {
  const f = load();
  f.engagement.squadRates[0]!.role = "<b>Analista de dados</b>";
  f.opportunities[0]!.suggestedSquad.roles = ["<b>Analista de dados</b>"];
  f.opportunities[1]!.suggestedSquad.roles = ["Engenheiro de automação", "<b>Analista de dados</b>"];
  f.opportunities[2]!.suggestedSquad.weeks = 100;
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW, f.initiatives);
  assert.equal(m.investment.paybackOverCap, true);
  const html = renderI(f);
  assert.ok(html.includes("&gt; 36 meses"));
  assert.ok(!html.includes("<b>Analista"));
  assert.ok(html.includes("&lt;b&gt;Analista de dados&lt;/b&gt;"));
});

test("formatPayback", () => {
  assert.equal(formatPayback(27.5, false), "27,5 meses");
  assert.equal(formatPayback(80, true), "> 36 meses");
  assert.equal(formatPayback(null, false), "—");
});

test("an extreme rate that bypassed the schema never prints Infinity or NaN", () => {
  const f = load();
  f.engagement.squadRates[0]!.weeklyRate = 1e308;
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW, f.initiatives);
  assert.equal(m.investment.total, null);
  assert.equal(m.investment.note, "valor de tarifa fora do limite");
  assert.ok(!/NaN|Infinity|undefined/.test(renderI(f)));
});

test("a shadowed duplicate rate is not listed in the appendix; the first entry applies", () => {
  const f = load();
  f.engagement.squadRates.push({ role: " product OWNER", weeklyRate: 123456 });
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW, f.initiatives);
  assert.equal(m.investment.total, 179000); // same as without the duplicate
  const rows = m.assumptions.filter((a) => a.label.startsWith("Tarifa semanal"));
  assert.equal(rows.length, 4);
  assert.ok(!renderI(f).includes(escapeHtml(formatCurrency(123456, "BRL"))));
});

test("with no savings the result tile does not claim savings start at delivery", () => {
  const f = load();
  f.opportunities.forEach((o) => { o.stepIds = []; });
  const html = renderI(f);
  assert.ok(html.includes("Sem economia mensal calculada"));
  assert.ok(!html.includes("Economia a partir da entrega"));
  assert.ok(renderI(load()).includes("Economia a partir da entrega"));
});

test("no visible opportunity: investment 0, payback not shown, no NaN", () => {
  const f = load();
  f.opportunities.forEach((o) => { o.hidden = true; });
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW, f.initiatives);
  assert.equal(m.investment.squadCost, 0);
  assert.equal(m.investment.paybackMonths, null);
  assert.equal(m.totals.monthlySavings, 0);
  assert.ok(!/NaN|Infinity|undefined/.test(renderI(f)));
});

test("a wave whose opportunities have 0 weeks costs nothing and allocates nothing", () => {
  const f = load();
  f.opportunities[0]!.suggestedSquad.weeks = 0;
  const m = buildReportModel(f.engagement, f.maps, f.opportunities, NOW, f.initiatives);
  assert.equal(m.squadByWave[0]!.cost, 0);
  assert.equal(m.opportunities[0]!.investment, 0);
  assert.equal(m.opportunities[0]!.paybackMonths, 0);
  assert.ok(!/NaN|Infinity|undefined/.test(renderI(f)));
});
