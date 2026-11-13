import assert from "node:assert/strict";
import test from "node:test";

import type { DataQuestionnaire, Engagement, Opportunity, Process, ProcessMap, ProcessMapStep, Role } from "./diagnostic";
import {
  aggregateSavings,
  aiMaturity,
  aiReadinessScore,
  dataScore,
  missingSquadRates,
  observedStructuredRatio,
  opportunityInvestments,
  paybackMonths,
  programInvestment,
  programReturn,
  waveInvestments,
  opportunityReadiness,
  overallProcessScore,
  opportunitySavings,
  processMonthlyCost,
  processScore,
  stepMonthlyCost,
  weakestDimension,
} from "./diagnostic-math";

const step = (id: string, ms: number | null, over: Partial<ProcessMapStep> = {}): ProcessMapStep => ({
  id,
  title: id,
  medianDurationMs: ms,
  apps: [],
  dataArtifacts: [],
  dataStructure: "structured",
  manualTransfer: false,
  rework: false,
  owner: "ana",
  sourceStepRefs: [],
  ...over,
});

const mkMap = (steps: ProcessMapStep[], variants = 0): ProcessMap => ({
  version: 1,
  processId: "p1",
  revision: 1,
  createdAt: 1,
  steps,
  variants: Array.from({ length: variants }, (_, i) => ({ stepId: steps[0]?.id ?? "x", description: `v${i}` })),
  confidence: "high",
});

const role: Role = { id: "r1", name: "Analista", hourlyCost: 60 };
const proc: Process = {
  id: "p1",
  name: "P",
  sessionIds: [],
  roleId: "r1",
  volumePerMonth: { value: 100, source: "confirmed" },
  stale: false,
};
const map = mkMap([step("s1", 30 * 60_000), step("s2", 90 * 60_000)]);

const opp = (over: Partial<Opportunity> = {}): Opportunity => ({
  id: "o1",
  title: "T",
  processId: "p1",
  stepIds: ["s2"],
  wave: 1,
  prerequisites: [],
  estimatedSavingsPct: { value: 0.5, source: "ai-suggested" },
  effort: "S",
  risk: "low",
  rationale: "",
  suggestedSquad: { roles: [], weeks: 1 },
  hidden: false,
  order: 0,
  ...over,
});

test("processMonthlyCost sums step costs", () => {
  assert.equal(processMonthlyCost(map, proc, role), 12000);
});

test("wave 1 caps savings at 30%", () => {
  const r = opportunitySavings(opp(), map, proc, role);
  assert.equal(r.monthlyCostToday, 9000);
  assert.equal(r.appliedPct, 0.3);
  assert.equal(r.capped, true);
  assert.equal(r.monthlySavings, 2700);
});

test("uncapped savings use the estimated pct", () => {
  const r = opportunitySavings(opp({ estimatedSavingsPct: { value: 0.2, source: "measured" } }), map, proc, role);
  assert.equal(r.appliedPct, 0.2);
  assert.equal(r.capped, false);
  assert.equal(r.monthlySavings, 1800);
});

test("null duration contributes 0", () => {
  assert.equal(stepMonthlyCost(step("s", null), proc, role), 0);
  assert.equal(processMonthlyCost(mkMap([step("a", null), step("b", 3_600_000)]), proc, role), 6000);
});

test("missing volume, role or hourly cost yields 0", () => {
  assert.equal(processMonthlyCost(map, { ...proc, volumePerMonth: undefined }, role), 0);
  assert.equal(processMonthlyCost(map, proc, undefined), 0);
});

test("aiReadinessScore(40, 80) === 46", () => {
  assert.equal(aiReadinessScore(40, 80), 46);
});

test("dataScore is 100 with all answers 4 and all steps structured", () => {
  const q: DataQuestionnaire = {
    inventory: { answer: 4, source: "confirmed", evidence: [] },
    structure: { answer: 4, source: "confirmed", evidence: [] },
  };
  assert.equal(dataScore(q, [map]), 100);
});

test("dataScore with no answers and no steps is 0", () => {
  assert.equal(dataScore({}, []), 0);
  assert.equal(observedStructuredRatio([]), 0);
});

test("processScore never goes below 0", () => {
  const bad = mkMap(
    [step("a", 1, { manualTransfer: true, rework: true, owner: undefined })],
    50,
  );
  assert.equal(processScore(bad), 0);
});

test("processScore applies penalties", () => {
  const m = mkMap([step("a", 1, { manualTransfer: true }), step("b", 1)], 1);
  // 100 - 5 - 30*0.5 = 80
  assert.equal(processScore(m), 80);
});

test("opportunityReadiness per wave", () => {
  assert.equal(opportunityReadiness(opp({ wave: 1 }), 40, 80), 100);
  assert.equal(opportunityReadiness(opp({ wave: 2 }), 40, 80), 40);
  assert.equal(opportunityReadiness(opp({ wave: 3 }), 40, 80), 46);
});

const aggEngagement = (): Engagement => ({
  version: 1,
  squadRates: [],
  id: "e",
  clientName: "c",
  createdAt: 0,
  currency: "BRL",
  roles: [{ id: "r1", name: "A", hourlyCost: 100 }],
  dataQuestionnaire: {},
  processes: [
    { id: "p1", name: "P", sessionIds: [], roleId: "r1", volumePerMonth: { value: 10, source: "confirmed" }, stale: false },
  ],
  thesisText: "",
});
const H = 3_600_000;
const aggMap = (): ProcessMap => mkMap([step("a", H), step("b", H), step("c", H)], 0); // 1000 each

test("aggregateSavings takes the max, not the sum, for opportunities on the same step", () => {
  const o1 = opp({ id: "o1", wave: 1, stepIds: ["a"], estimatedSavingsPct: { value: 0.3, source: "ai-suggested" } });
  const o2 = opp({ id: "o2", wave: 2, stepIds: ["a"], estimatedSavingsPct: { value: 0.5, source: "ai-suggested" } });
  assert.equal(aggregateSavings([o1, o2], { p1: aggMap() }, aggEngagement()), 500);
});

test("aggregateSavings sums disjoint steps, applies wave caps and never exceeds process cost", () => {
  const o1 = opp({ id: "o1", wave: 1, stepIds: ["a"], estimatedSavingsPct: { value: 0.9, source: "ai-suggested" } }); // cap .3 -> 300
  const o2 = opp({ id: "o2", wave: 3, stepIds: ["b", "c"], estimatedSavingsPct: { value: 1, source: "ai-suggested" } }); // cap .8 -> 1600
  const e = aggEngagement();
  const total = aggregateSavings([o1, o2], { p1: aggMap() }, e);
  assert.equal(total, 1900);
  assert.ok(total <= processMonthlyCost(aggMap(), e.processes[0]!, e.roles[0]));
  assert.equal(aggregateSavings([], { p1: aggMap() }, e), 0);
  assert.equal(aggregateSavings([o1], {}, e), 0);
});

test("overallProcessScore is the integer mean of per-process scores", () => {
  const a = mkMap([step("a", 1, { manualTransfer: true }), step("b", 1)], 1); // 80
  const b = mkMap([step("a", 1)], 0); // 100
  assert.equal(overallProcessScore([a, b]), 90);
  assert.equal(overallProcessScore([]), 0);
});

test("aiMaturity maps the AI readiness score to five levels", () => {
  assert.deepEqual(aiMaturity(0), { level: 1, name: "Inicial", nextLevel: { level: 2, name: "Exploratório", pointsNeeded: 20 } });
  assert.equal(aiMaturity(40).level, 3);
  assert.equal(aiMaturity(40).name, "Estruturado");
  assert.deepEqual(aiMaturity(80), { level: 5, name: "Nativo em IA", nextLevel: null });
  assert.deepEqual(aiMaturity(79).nextLevel, { level: 5, name: "Nativo em IA", pointsNeeded: 1 });
  assert.equal(aiMaturity(79).level, 4);
  assert.equal(aiMaturity(100).level, 5);
  assert.equal(aiMaturity(-5).level, 1);
});

test("weakestDimension picks the lower score; ties go to dados", () => {
  assert.equal(weakestDimension(30, 60), "processos");
  assert.equal(weakestDimension(60, 30), "dados");
  assert.equal(weakestDimension(50, 50), "dados");
});

// --- squad cost and return ---------------------------------------------------------------------

const sq = (id: string, wave: 1 | 2 | 3, roles: string[], weeks: number, over: Partial<Opportunity> = {}): Opportunity =>
  opp({ id, wave, suggestedSquad: { roles, weeks }, ...over });
const rate = (role: string, weeklyRate: number) => ({ role, weeklyRate });

test("wave cost: 3 roles at 4000/week over 5 weeks is 60000, split pro rata by weeks", () => {
  const roles = ["Dev", "QA", "PO"];
  const opps = [sq("a", 1, roles, 2), sq("b", 1, roles, 3)];
  const rates = [rate("Dev", 4000), rate("QA", 4000), rate("PO", 4000)];
  const w = waveInvestments(opps, rates)[0]!;
  assert.equal(w.weeks, 5);
  assert.equal(w.cost, 60000);
  assert.deepEqual([...opportunityInvestments(opps, rates)], [["a", 24000], ["b", 36000]]);
  assert.equal(waveInvestments(opps, rates)[1]!.cost, 0); // empty wave costs nothing
});

test("the squad is booked for the whole wave: a role used by one opportunity is paid for every week", () => {
  const opps = [sq("a", 2, ["Dev"], 2), sq("b", 2, ["Dev", "QA"], 4)];
  const rates = [rate("Dev", 1000), rate("QA", 500)];
  // 6 wave weeks x (1000 + 500), not 2x1000 + 4x1500
  assert.equal(waveInvestments(opps, rates)[1]!.cost, 9000);
});

test("role names match case-insensitively and trimmed; hidden opportunities are ignored", () => {
  const opps = [sq("a", 1, ["Analista de dados "], 2), sq("h", 1, ["Segredo"], 9, { hidden: true })];
  const rates = [rate("analista de DADOS", 100)];
  assert.equal(waveInvestments(opps, rates)[0]!.cost, 200);
  assert.deepEqual(missingSquadRates(opps, rates), []);
});

test("pro rata allocation adds up to the wave cost to the cent", () => {
  const opps = [sq("a", 1, ["Dev"], 1), sq("b", 1, ["Dev"], 1), sq("c", 1, ["Dev"], 1)];
  const alloc = opportunityInvestments(opps, [rate("Dev", 100)]); // 300 / 3 weeks, odd split of cents
  assert.equal([...alloc.values()].reduce<number>((a, v) => a + (v ?? 0), 0), 300);
  const odd = opportunityInvestments(opps, [rate("Dev", 100.01)]);
  assert.equal(Math.round([...odd.values()].reduce<number>((a, v) => a + (v ?? 0), 0) * 100) / 100, 300.03);
});

test("a missing rate makes cost, allocation and total null, never partial", () => {
  const opps = [sq("a", 1, ["Dev"], 2), sq("b", 2, ["Dev", "QA"], 2)];
  const rates = [rate("Dev", 1000)];
  assert.deepEqual(missingSquadRates(opps, rates), ["QA"]);
  const w = waveInvestments(opps, rates);
  assert.equal(w[0]!.cost, 2000);
  assert.equal(w[1]!.cost, null);
  const alloc = opportunityInvestments(opps, rates);
  assert.equal(alloc.get("a"), 2000);
  assert.equal(alloc.get("b"), null);
  const prog = programInvestment(opps, rates);
  assert.equal(prog.squadCost, null);
  assert.equal(prog.total, null);
  assert.deepEqual(prog.missingRoles, ["QA"]);
});

test("program investment adds enablement days x day rate only when the rate is set", () => {
  const opps = [sq("a", 1, ["Dev"], 2)];
  const rates = [rate("Dev", 1000)];
  const en = (id: string, durationDays: number, hidden = false) =>
    ({ id, title: id, format: "workshop", audience: "x", gap: "ia", rationale: "", durationDays, hidden, order: 0 }) as const;
  const items = [en("e1", 2), en("e2", 3), en("e3", 10, true)];
  assert.equal(programInvestment(opps, rates, items).total, 2000);
  assert.equal(programInvestment(opps, rates, items, 500).enablementCost, 2500);
  assert.equal(programInvestment(opps, rates, items, 500).total, 4500);
  assert.equal(programInvestment(opps, rates, items, 0).total, 2000);
});

test("payback is investment divided by monthly savings; null when unknown or savings are zero", () => {
  assert.equal(paybackMonths(60000, 2000), 30);
  assert.equal(paybackMonths(0, 2000), 0);
  assert.equal(paybackMonths(null, 2000), null);
  assert.equal(paybackMonths(60000, 0), null);
  assert.equal(paybackMonths(60000, Number.NaN), null);
});

test("programReturn: delivery months, 36-month cap and net result", () => {
  // 26 weeks = 6 months; savings start then: (36 - 6) x 2000 - 50000 = 10000
  const r = programReturn(50000, 2000, 26);
  assert.equal(r.deliveryMonths, 6);
  assert.equal(r.paybackMonths, 25);
  assert.equal(r.paybackOverCap, false);
  assert.equal(r.netOver36Months, 10000);
  // payback 60 months: over the cap, net negative
  const bad = programReturn(120000, 2000, 26);
  assert.equal(bad.paybackMonths, 60);
  assert.equal(bad.paybackOverCap, true);
  assert.equal(bad.netOver36Months, (36 - 6) * 2000 - 120000);
  // delivery beyond the horizon: no savings inside it, net is minus the investment
  assert.equal(programReturn(1000, 500, 52 * 4).netOver36Months, -1000);
  // unknown investment or no savings
  assert.deepEqual([programReturn(null, 2000, 26).paybackMonths, programReturn(null, 2000, 26).netOver36Months], [null, null]);
  const none = programReturn(1000, 0, 26);
  assert.equal(none.paybackMonths, null);
  assert.equal(none.netOver36Months, -1000);
});
