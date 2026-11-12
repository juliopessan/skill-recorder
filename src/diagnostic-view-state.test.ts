import assert from "node:assert/strict";
import test from "node:test";

import type { Engagement, Opportunity, Process, ProcessMap } from "../common/diagnostic";
import {
  canGenerateMap,
  confirmField,
  mergeSuggestedQuestionnaire,
  moveOpportunity,
  nextStep,
  setOpportunityHidden,
} from "./diagnostic-view-state";

const proc = (over: Partial<Process> = {}): Process => ({
  id: "p1",
  name: "Conciliação",
  sessionIds: ["a", "b"],
  stale: false,
  ...over,
});
const eng = (over: Partial<Engagement> = {}): Engagement => ({
  version: 1,
  id: "e1",
  clientName: "Cliente",
  createdAt: 0,
  currency: "BRL",
  roles: [{ id: "r1", name: "Analista", hourlyCost: 50 }],
  dataQuestionnaire: {},
  processes: [proc()],
  thesisText: "",
  ...over,
});
const map = (processId = "p1"): ProcessMap => ({
  version: 1,
  processId,
  revision: 1,
  createdAt: 0,
  steps: [],
  variants: [],
  confidence: "high",
});
const opp = (id: string, order: number, hidden = false): Opportunity => ({
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
  hidden,
  order,
});
const full = {
  inventory: { answer: 2 as const, source: "confirmed" as const, evidence: [] },
  structure: { answer: 2 as const, source: "confirmed" as const, evidence: [] },
  quality: { answer: 2 as const, source: "confirmed" as const, evidence: [] },
  access: { answer: 2 as const, source: "confirmed" as const, evidence: [] },
  governance: { answer: 2 as const, source: "confirmed" as const, evidence: [] },
};

test("canGenerateMap blocks a stale process", () => {
  const r = canGenerateMap(proc({ stale: true }), new Set(["a", "b"]));
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /desatualizado/);
});

test("canGenerateMap blocks when no linked session has an analysis", () => {
  assert.equal(canGenerateMap(proc(), new Set(["z"])).ok, false);
  assert.equal(canGenerateMap(proc({ sessionIds: [] }), new Set(["a"])).ok, false);
});

test("canGenerateMap allows a single session with a low-confidence note", () => {
  const r = canGenerateMap(proc({ sessionIds: ["a"] }), new Set(["a"]));
  assert.deepEqual(r, { ok: true, reason: "Baixa confiança: sem variação medida" });
});

test("canGenerateMap allows several analyzed sessions without a note", () => {
  const r = canGenerateMap(proc(), new Set(["a", "b", "c"]));
  assert.deepEqual(r, { ok: true });
});

test("confirmField marks a value confirmed, optionally replacing it", () => {
  assert.deepEqual(confirmField({ value: 3, source: "ai-suggested" }), { value: 3, source: "confirmed" });
  assert.deepEqual(confirmField({ value: 3, source: "measured" }, 7), { value: 7, source: "confirmed" });
});

test("nextStep walks the flow in order", () => {
  assert.equal(nextStep(eng({ roles: [] }), {}, []), "roles");
  assert.equal(nextStep(eng({ processes: [] }), {}, []), "processes");
  assert.equal(nextStep(eng(), {}, []), "questionnaire");
  assert.equal(nextStep(eng({ dataQuestionnaire: full }), {}, []), "maps");
  const withMap = { p1: map() };
  assert.equal(nextStep(eng({ dataQuestionnaire: full }), withMap, []), "baseline");
  const baselined = eng({
    dataQuestionnaire: full,
    processes: [
      proc({
        roleId: "r1",
        volumePerMonth: { value: 10, source: "confirmed" },
        peopleCount: { value: 2, source: "confirmed" },
      }),
    ],
  });
  assert.equal(nextStep(baselined, withMap, []), "opportunities");
  assert.equal(nextStep(baselined, withMap, [opp("o1", 0)]), "report");
});

test("nextStep treats unconfirmed questionnaire answers as pending", () => {
  const q = { ...full, access: { answer: 3 as const, source: "ai-suggested" as const, evidence: [] } };
  assert.equal(nextStep(eng({ dataQuestionnaire: q }), {}, []), "questionnaire");
});

test("moveOpportunity swaps with the neighbour and renumbers", () => {
  const out = moveOpportunity([opp("a", 5), opp("b", 9), opp("c", 12)], "c", -1);
  assert.deepEqual(out.map((o) => [o.id, o.order]), [["a", 0], ["c", 1], ["b", 2]]);
});

test("moveOpportunity at the edge keeps the order", () => {
  const out = moveOpportunity([opp("a", 0), opp("b", 1)], "a", -1);
  assert.deepEqual(out.map((o) => o.id), ["a", "b"]);
});

test("setOpportunityHidden toggles only the target", () => {
  const out = setOpportunityHidden([opp("a", 0), opp("b", 1)], "b", true);
  assert.deepEqual(out.map((o) => o.hidden), [false, true]);
});

test("mergeSuggestedQuestionnaire never overwrites confirmed answers", () => {
  const current = { structure: { answer: 4 as const, source: "confirmed" as const, evidence: [] } };
  const suggested = {
    structure: { answer: 1 as const, source: "ai-suggested" as const, evidence: ["x"] },
    access: { answer: 3 as const, source: "ai-suggested" as const, evidence: ["y"] },
  };
  const out = mergeSuggestedQuestionnaire(current, suggested);
  assert.equal(out.structure?.answer, 4);
  assert.equal(out.access?.source, "ai-suggested");
});
