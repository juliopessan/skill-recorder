import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { Engagement, Opportunity, ProcessMap } from "./diagnostic";
import { DEFAULT_THESIS_TEXT, DIAGNOSTIC_CONFIG_VERSION } from "./diagnostic-config";
import { buildReportModel, escapeHtml, renderReportHtml } from "./diagnostic-report";

type Fixture = { engagement: Engagement; maps: Record<string, ProcessMap>; opportunities: Opportunity[] };
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

test("all eight sections render in order", () => {
  const f = load();
  const html = renderReportHtml(buildReportModel(f.engagement, f.maps, f.opportunities, NOW), f.engagement, f.maps);
  const ids = ["resumo", "antes-da-ia", "mapa", "dados", "oportunidades", "roadmap", "squad", "premissas"];
  const positions = ids.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((p) => p >= 0), `missing section: ${positions.join(",")}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  for (const t of ["Onda 1", "Onda 2", "Onda 3", "0–3 meses", "3–6 meses", "6–12 meses"]) assert.ok(html.includes(t), t);
  assert.ok(html.includes("R$"));
  assert.match(html, /#2e7d5b/i); // structured green is used
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
