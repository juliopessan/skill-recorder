import assert from "node:assert/strict";
import test from "node:test";

import type { Engagement, Opportunity, ProcessMap, ProcessMapStep } from "./diagnostic";
import {
  draftReasons,
  isQuickWin,
  prerequisitePath,
  squadByWave,
  suggestQuestionnaire,
  validateOpportunities,
  validateSquadSize,
} from "./diagnostic-rules";

const opp = (id: string, over: Partial<Opportunity> = {}): Opportunity => ({
  id,
  title: id,
  processId: "p1",
  stepIds: [],
  wave: 1,
  prerequisites: [],
  estimatedSavingsPct: { value: 0.1, source: "ai-suggested" },
  effort: "S",
  risk: "low",
  rationale: "",
  suggestedSquad: { roles: [], weeks: 1 },
  hidden: false,
  order: 0,
  ...over,
});

const step = (id: string, over: Partial<ProcessMapStep> = {}): ProcessMapStep => ({
  id,
  title: id,
  medianDurationMs: 1000,
  apps: [],
  dataArtifacts: [],
  dataStructure: "structured",
  manualTransfer: false,
  rework: false,
  sourceStepRefs: [],
  ...over,
});

const mkMap = (steps: ProcessMapStep[]): ProcessMap => ({
  version: 1,
  processId: "p1",
  revision: 1,
  createdAt: 1,
  steps,
  variants: [],
  confidence: "high",
});

test("validateOpportunities accepts a valid DAG", () => {
  assert.deepEqual(validateOpportunities([opp("A"), opp("B", { prerequisites: ["A"] })]), { ok: true });
});

test("validateOpportunities rejects a cycle naming both ids", () => {
  const r = validateOpportunities([opp("A", { prerequisites: ["B"] }), opp("B", { prerequisites: ["A"] })]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.error, /A/);
    assert.match(r.error, /B/);
  }
});

test("validateOpportunities rejects unknown prerequisite and self reference", () => {
  const u = validateOpportunities([opp("A", { prerequisites: ["ZZ"] })]);
  assert.equal(u.ok, false);
  if (!u.ok) assert.match(u.error, /ZZ/);
  const s = validateOpportunities([opp("A", { prerequisites: ["A"] })]);
  assert.equal(s.ok, false);
});

const engagement = (over: Record<string, unknown> = {}): Engagement => ({
  version: 1,
  id: "e1",
  clientName: "ACME",
  createdAt: 1,
  currency: "BRL",
  roles: [{ id: "r1", name: "Analista", hourlyCost: 50 }],
  dataQuestionnaire: Object.fromEntries(
    ["inventory", "structure", "quality", "access", "governance"].map((a) => [a, { answer: 3, source: "confirmed", evidence: [] }]),
  ),
  processes: [
    {
      id: "p1",
      name: "P1",
      sessionIds: [],
      roleId: "r1",
      volumePerMonth: { value: 10, source: "confirmed" },
      peopleCount: { value: 2, source: "confirmed" },
      stale: false,
      ...over,
    },
  ],
  thesisText: "",
});

test("draftReasons is empty for a fully confirmed engagement", () => {
  assert.deepEqual(draftReasons(engagement(), { p1: mkMap([step("s1")]) }), []);
});

test("draftReasons flags ai-suggested volume, missing map, role, zero cost and stale", () => {
  const maps = { p1: mkMap([step("s1")]) };
  assert.ok(draftReasons(engagement({ volumePerMonth: { value: 10, source: "ai-suggested" } }), maps).length > 0);
  assert.ok(draftReasons(engagement({ peopleCount: { value: 2, source: "measured" } }), maps).length > 0);
  assert.ok(draftReasons(engagement(), {}).length > 0);
  assert.ok(draftReasons(engagement({ roleId: undefined }), maps).length > 0);
  assert.ok(draftReasons(engagement({ stale: true }), maps).length > 0);
  const zero = engagement();
  zero.roles[0]!.hourlyCost = 0;
  assert.ok(draftReasons(zero, maps).length > 0);
});

test("draftReasons flags each unanswered or unconfirmed questionnaire axis", () => {
  const maps = { p1: mkMap([step("s1")]) };
  const e = engagement();
  delete e.dataQuestionnaire.access;
  e.dataQuestionnaire.quality = { answer: 2, source: "ai-suggested", evidence: [] };
  const reasons = draftReasons(e, maps);
  assert.equal(reasons.length, 2);
  assert.ok(reasons.some((r) => r.includes("Acesso") && r.includes("não foi respondido")));
  assert.ok(reasons.some((r) => r.includes("Qualidade") && r.includes("não foi confirmada")));
  assert.equal(draftReasons({ ...engagement(), dataQuestionnaire: {} }, maps).length, 5);
});

test("isQuickWin: wave-3 S opp with a prerequisite is not a quick win", () => {
  const a = opp("A");
  const b = opp("B", { wave: 3, effort: "S", prerequisites: ["A"] });
  assert.equal(isQuickWin(b, [a, b]), false);
  assert.equal(isQuickWin(a, [a, b]), true);
  assert.equal(isQuickWin(opp("C", { effort: "M" }), []), false);
});

test("prerequisitePath returns transitive prerequisites in topological order", () => {
  const a = opp("A");
  const b = opp("B", { prerequisites: ["A"] });
  const c = opp("C", { prerequisites: ["B", "A"] });
  assert.deepEqual(prerequisitePath(c, [a, b, c]).map((o) => o.id), ["A", "B"]);
});

test("suggestQuestionnaire derives structure from 3/4 structured steps", () => {
  const q = suggestQuestionnaire([
    mkMap([step("a"), step("b"), step("c"), step("d", { dataStructure: "unstructured" })]),
  ]);
  assert.equal(q.structure?.answer, 4);
  assert.equal(q.structure?.source, "ai-suggested");
  assert.ok(q.structure!.evidence[0]!.includes("75"));
  assert.equal(q.access?.answer, 4);
  assert.equal(q.quality?.answer, 4);
  assert.equal(q.inventory, undefined);
  assert.equal(q.governance, undefined);
});

test("suggestQuestionnaire inverts buckets for manual transfer and rework", () => {
  const q = suggestQuestionnaire([
    mkMap([step("a", { manualTransfer: true, rework: true }), step("b", { manualTransfer: true }), step("c")]),
  ]);
  assert.equal(q.access?.answer, 2); // 2/3 ≈ 0.67
  assert.equal(q.quality?.answer, 3); // 1/3 ≈ 0.33
});

test("suggestQuestionnaire with no steps suggests nothing", () => {
  assert.deepEqual(suggestQuestionnaire([]), {});
});

const squad = (roles: string[]) => ({ roles, weeks: 1 });

test("squadByWave merges roles case-insensitively per wave, keeping the first spelling", () => {
  const r = squadByWave([
    opp("A", { wave: 1, suggestedSquad: squad(["Analista de dados", "PO"]) }),
    opp("B", { wave: 1, suggestedSquad: squad(["analista de dados ", "Engenheiro"]) }),
    opp("C", { wave: 2, suggestedSquad: squad(["PO"]) }),
    opp("H", { wave: 2, hidden: true, suggestedSquad: squad(["Oculto"]) }),
  ]);
  assert.deepEqual(r, [
    { wave: 1, roles: ["Analista de dados", "PO", "Engenheiro"] },
    { wave: 2, roles: ["PO"] },
    { wave: 3, roles: [] },
  ]);
});

test("validateSquadSize accepts duplicates written differently as one person", () => {
  assert.deepEqual(
    validateSquadSize([
      opp("A", { suggestedSquad: squad(["Analista de dados", "a", "b", "c"]) }),
      opp("B", { suggestedSquad: squad(["analista de dados ", "c", "d"]) }),
    ]),
    { ok: true },
  );
});

test("validateSquadSize rejects a wave needing 6 distinct roles and an opportunity with 6 roles", () => {
  const wave = validateSquadSize([
    opp("A", { wave: 2, suggestedSquad: squad(["a", "b", "c"]) }),
    opp("B", { wave: 2, suggestedSquad: squad(["d", "e", "f"]) }),
  ]);
  assert.equal(wave.ok, false);
  if (!wave.ok) assert.match(wave.error, /onda 2.*6.*5/i);
  const one = validateSquadSize([opp("A", { suggestedSquad: squad(["a", "b", "c", "d", "e", "f"]) })]);
  assert.equal(one.ok, false);
  if (!one.ok) assert.match(one.error, /"A"/);
});
