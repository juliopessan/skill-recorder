import assert from "node:assert/strict";
import test from "node:test";

import type { Opportunity, Process, ProcessMap, ProcessMapStep, Role } from "./diagnostic";
import {
  aiReadinessScore,
  dataScore,
  observedStructuredRatio,
  opportunityReadiness,
  opportunitySavings,
  processMonthlyCost,
  processScore,
  stepMonthlyCost,
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
  const q = {
    inventory: { answer: 4, source: "confirmed", evidence: [] },
    structure: { answer: 4, source: "confirmed", evidence: [] },
  } as const;
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
