import assert from "node:assert/strict";
import test from "node:test";

import type { Engagement, Opportunity, Process, ProcessMap } from "../common/diagnostic";
import {
  canGenerateMap,
  createUpdateQueue,
  confirmField,
  mergeSuggestedQuestionnaire,
  moveOpportunity,
  nextStep,
  parseNonNegative,
  NEGATIVE_RESULT_WARNING,
  PAYBACK_WARNING,
  RATE_MAX_ERROR,
  validateOptionalRate,
  SAVE_FAILED_MESSAGE,
  setOpportunityHidden,
  setSquadRate,
  squadRateRows,
  squadReturnWarning,
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
  squadRates: over.squadRates ?? [],
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

test("nextStep sends a process without a role, or with a zero hourly cost, back to baseline", () => {
  const confirmed = {
    volumePerMonth: { value: 10, source: "confirmed" as const },
    peopleCount: { value: 2, source: "confirmed" as const },
  };
  const withMap = { p1: map() };
  const noRole = eng({ dataQuestionnaire: full, processes: [proc({ ...confirmed })] });
  assert.equal(nextStep(noRole, withMap, [opp("o1", 0)]), "baseline");
  const free = eng({
    dataQuestionnaire: full,
    roles: [{ id: "r1", name: "Analista", hourlyCost: 0 }],
    processes: [proc({ ...confirmed, roleId: "r1" })],
  });
  assert.equal(nextStep(free, withMap, [opp("o1", 0)]), "baseline");
});

test("parseNonNegative accepts comma decimals and rejects empty, negative and text", () => {
  assert.equal(parseNonNegative("12,5"), 12.5);
  assert.equal(parseNonNegative(" 0 "), 0);
  assert.equal(parseNonNegative(""), null);
  assert.equal(parseNonNegative("-1"), null);
  assert.equal(parseNonNegative("abc"), null);
});

test("update queue: two updaters enqueued before the first save resolves both reach the saved value", async () => {
  const saved: { a: number; b: number }[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const q = createUpdateQueue({ a: 0, b: 0 }, async (v) => {
    if (saved.length === 0) await gate;
    saved.push(v);
    return null;
  });
  const first = q.enqueue((p) => ({ ...p, a: 1 }));
  const second = q.enqueue((p) => ({ ...p, b: 2 }));
  release();
  assert.deepEqual(await Promise.all([first, second]), [null, null]);
  assert.deepEqual(saved.at(-1), { a: 1, b: 2 });
  assert.deepEqual(q.get(), { a: 1, b: 2 });
});

test("update queue: saves run one at a time, in order", async () => {
  const order: string[] = [];
  const q = createUpdateQueue(0, async (v) => {
    order.push(`start${v}`);
    await new Promise((r) => setTimeout(r, 5));
    order.push(`end${v}`);
    return null;
  });
  await Promise.all([q.enqueue((p) => p + 1), q.enqueue((p) => p + 1)]);
  assert.deepEqual(order, ["start2", "end2", "start2", "end2"]);
});

test("update queue: a failing save reports the error and does not drop later updates", async () => {
  const saved: number[] = [];
  let calls = 0;
  const q = createUpdateQueue(0, async (v) => {
    calls++;
    if (calls === 1) return "Falhou.";
    saved.push(v);
    return null;
  });
  const first = q.enqueue((p) => p + 1);
  const second = q.enqueue((p) => p + 10);
  assert.equal(await first, "Falhou.");
  assert.equal(await second, null);
  assert.deepEqual(saved, [11]);
});

test("update queue: a rejected save becomes an error message and the queue keeps working", async () => {
  let calls = 0;
  const q = createUpdateQueue(0, async () => {
    if (++calls === 1) throw new Error("boom");
    return null;
  });
  assert.equal(await q.enqueue((p) => p + 1), SAVE_FAILED_MESSAGE);
  assert.equal(await q.enqueue((p) => p + 1), null);
  assert.equal(q.get(), 2);
});

test("update queue: sync is ignored while edits are pending and adopted when idle", async () => {
  const q = createUpdateQueue(0, async () => null);
  const p = q.enqueue((v) => v + 1);
  q.sync(99);
  assert.equal(q.get(), 1);
  await p;
  q.sync(99);
  assert.equal(q.get(), 99);
});

test("move and hide also work for enablement and expansion items", () => {
  const items = [
    { id: "c1", title: "A", order: 0, hidden: false },
    { id: "c2", title: "B", order: 1, hidden: false },
  ];
  assert.deepEqual(moveOpportunity(items, "c2", -1).map((x) => [x.id, x.order, x.title]), [["c2", 0, "B"], ["c1", 1, "A"]]);
  assert.equal(setOpportunityHidden(items, "c1", true)[0]!.hidden, true);
});

const sqOpp = (id: string, wave: 1 | 2 | 3, roles: string[], hidden = false): Opportunity => ({
  id, title: id, processId: "p1", stepIds: [], wave, prerequisites: [],
  estimatedSavingsPct: { value: 0.1, source: "ai-suggested" }, effort: "S", risk: "low", rationale: "",
  suggestedSquad: { roles, weeks: 2 }, hidden, order: 0,
});

test("squadRateRows lists each distinct visible role once, then saved rates no longer in use", () => {
  const opps = [
    sqOpp("a", 1, ["Dev", "QA "]),
    sqOpp("b", 2, ["dev", "PO"]),
    sqOpp("h", 1, ["Oculto"], true),
  ];
  const rows = squadRateRows(opps, [{ role: "qa", weeklyRate: 900 }, { role: "Antigo", weeklyRate: 50 }, { role: "Oculto", weeklyRate: 7 }]);
  assert.deepEqual(rows, [
    { role: "Dev", weeklyRate: null, inUse: true },
    { role: "QA", weeklyRate: 900, inUse: true },
    { role: "PO", weeklyRate: null, inUse: true },
    { role: "Antigo", weeklyRate: 50, inUse: false },
    { role: "Oculto", weeklyRate: 7, inUse: false },
  ]);
  assert.deepEqual(squadRateRows([], []), []);
});

test("setSquadRate adds, replaces case-insensitively, accepts zero and clears on null", () => {
  const base = [{ role: "Dev", weeklyRate: 100 }];
  assert.deepEqual(setSquadRate(base, "QA", 50), [{ role: "Dev", weeklyRate: 100 }, { role: "QA", weeklyRate: 50 }]);
  assert.deepEqual(setSquadRate(base, " dev ", 200), [{ role: "Dev", weeklyRate: 200 }]);
  assert.deepEqual(setSquadRate(base, "Dev", 0), [{ role: "Dev", weeklyRate: 0 }]);
  assert.deepEqual(setSquadRate(base, "DEV", null), []);
  assert.deepEqual(setSquadRate([{ role: "Dev", weeklyRate: 1 }, { role: "dev", weeklyRate: 2 }], "Dev", 3), [{ role: "Dev", weeklyRate: 3 }]);
  assert.equal(base[0]!.weeklyRate, 100); // pure
});

test("squadReturnWarning only fires on payback above 36 months or a negative result", () => {
  assert.equal(squadReturnWarning({ paybackOverCap: true, netOver36Months: -10 }), PAYBACK_WARNING);
  assert.equal(PAYBACK_WARNING, "Payback acima de 36 meses: revise escopo, volume ou preço antes de apresentar.");
  assert.equal(squadReturnWarning({ paybackOverCap: false, netOver36Months: -1 }), NEGATIVE_RESULT_WARNING);
  assert.equal(squadReturnWarning({ paybackOverCap: false, netOver36Months: 0 }), null);
  assert.equal(squadReturnWarning({ paybackOverCap: false, netOver36Months: null }), null);
});

test("validateOptionalRate accepts blank, zero and the maximum; rejects negatives, text and values above the bound", () => {
  for (const ok of ["", "  ", "0", "4000", "1500,50", "1000000"]) assert.equal(validateOptionalRate(ok), null, ok);
  assert.equal(validateOptionalRate("-1"), "Informe um número maior ou igual a zero.");
  assert.equal(validateOptionalRate("abc"), "Informe um número maior ou igual a zero.");
  assert.equal(validateOptionalRate("1000001"), RATE_MAX_ERROR);
  assert.match(RATE_MAX_ERROR, /1\.000\.000/);
});
