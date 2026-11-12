import assert from "node:assert/strict";
import test from "node:test";

import type { Analysis } from "../../common/analysis";
import type { OpportunitiesSubmission, ProcessMapSubmission } from "../../common/diagnostic";
import {
  allPass,
  checkMap,
  checkOpportunities,
  findCurrency,
  norm,
  recordingTerms,
  type MapExpect,
  type OppExpect,
} from "./checks";

const analysis = (sessionId: string, ids: string[], apps: string[]): Analysis => ({
  version: 1, sessionId, revision: 1, createdAt: 1, narrationSourceUpdatedAt: null, title: "t",
  intent: "i", intentConfidence: "high", intentRationale: "", feedbackLog: [], approved: false,
  steps: ids.map((id) => ({ id, title: id, detail: "d", apps, evidence: [], confidence: "medium" as const })),
});
const sessions = [
  { sessionId: "s1", analysis: analysis("s1", ["a", "b"], ["Microsoft Excel", "Microsoft Outlook"]) },
  { sessionId: "s2", analysis: analysis("s2", ["a"], ["ERP Protheus"]) },
];

const step = (id: string, title: string, apps: string[], refs: { sessionId: string; stepId: string }[]) => ({
  id, title, medianDurationMs: null, apps, dataArtifacts: [], dataStructure: "semi" as const,
  manualTransfer: true, rework: false, sourceStepRefs: refs,
});
const goodMap: ProcessMapSubmission = {
  steps: [
    step("m1", "Exportar extrato do ERP", ["ERP Protheus"], [{ sessionId: "s2", stepId: "a" }]),
    step("m2", "Conciliação na planilha", ["Microsoft Excel"], [{ sessionId: "s1", stepId: "a" }]),
    step("m3", "Avisar divergências por e-mail", ["Microsoft Outlook"], [{ sessionId: "s1", stepId: "b" }]),
  ],
  variants: [{ stepId: "m3", description: "Em uma gravação o aviso foi por portal." }],
  confidence: "medium",
};
const mapExpect: MapExpect = {
  minSteps: 3, maxSteps: 5, expectVariants: true,
  keyApps: ["excel", "outlook", "erp"],
  stepKeywords: [["extrato"], ["conciliacao", "planilha"], ["e-mail", "email"]],
};

const failing = (r: ReturnType<typeof checkMap>) => r.filter((c) => !c.pass).map((c) => c.name);

test("norm strips accents and case", () => {
  assert.equal(norm("Conciliação É"), "conciliacao e");
});

test("good map passes every check", () => {
  assert.deepEqual(failing(checkMap(goodMap, sessions, mapExpect)), []);
});

test("map: step count out of range fails", () => {
  const r = checkMap(goodMap, sessions, { ...mapExpect, minSteps: 4 });
  assert.deepEqual(failing(r), ["map: step count in range"]);
});

test("map: missing and dangling refs fail", () => {
  const bad: ProcessMapSubmission = {
    ...goodMap,
    steps: [
      { ...goodMap.steps[0]!, sourceStepRefs: [] },
      { ...goodMap.steps[1]!, sourceStepRefs: [{ sessionId: "s1", stepId: "zzz" }] },
      goodMap.steps[2]!,
    ],
  };
  assert.deepEqual(failing(checkMap(bad, sessions, mapExpect)), [
    "map: every step has sourceStepRefs",
    "map: sourceStepRefs resolve to real steps",
  ]);
});

test("map: no variants / orphan variant / missing app / keyword gap / currency fail", () => {
  assert.deepEqual(failing(checkMap({ ...goodMap, variants: [] }, sessions, mapExpect)), ["map: reports >=1 variant"]);
  assert.deepEqual(
    failing(checkMap({ ...goodMap, variants: [{ stepId: "nope", description: "x" }] }, sessions, mapExpect)),
    ["map: variants point at existing steps"],
  );
  assert.deepEqual(
    failing(checkMap(goodMap, sessions, { ...mapExpect, keyApps: ["salesforce"] })),
    ["map: key apps present"],
  );
  assert.deepEqual(
    failing(checkMap(goodMap, sessions, { ...mapExpect, stepKeywords: [["pagamento"]] })),
    ["map: step titles cover required keywords"],
  );
  const cur = { ...goodMap, steps: [{ ...goodMap.steps[0]!, title: "Exportar extrato de R$ 10" }, ...goodMap.steps.slice(1)] };
  assert.deepEqual(failing(checkMap(cur, sessions, mapExpect)), ["map: no currency in text"]);
});

test("map: variants not required when scenario has none", () => {
  const r = checkMap({ ...goodMap, variants: [] }, sessions, { ...mapExpect, expectVariants: false });
  assert.deepEqual(failing(r), []);
});

const opp = (id: string, wave: 1 | 2 | 3, prerequisites: string[], roles = ["Analista"]) => ({
  id, title: id, processId: "p1", stepIds: ["m1"], wave, prerequisites,
  estimatedSavingsPct: { value: 0.2, source: "ai-suggested" as const },
  effort: "M" as const, risk: "low" as const, rationale: "Dados primeiro, depois automação, depois IA.",
  suggestedSquad: { roles, weeks: 4 },
});
const enab = (id: string, gap: "processos" | "dados" | "ia") => ({
  id, title: id, format: "workshop" as const, audience: "Financeiro", gap, rationale: "r", durationDays: 2,
});
const goodOpps: OpportunitiesSubmission = {
  opportunities: [opp("o1", 1, []), opp("o2", 2, ["o1"]), opp("o3", 3, ["o2"])],
  enablement: [enab("e1", "dados"), enab("e2", "processos")],
  expansion: [{ id: "x1", area: "Tesouraria", rationale: "r", evidence: ["Planilha em Microsoft Excel repassada por e-mail"], relatedApps: [] }],
};
const oppExpect: OppExpect = {
  lowDataScore: true, weakDimensions: ["dados", "processos"],
  recordingTerms: recordingTerms(sessions, ["e-mail"]),
};
const failingO = (r: ReturnType<typeof checkOpportunities>) => r.filter((c) => !c.pass).map((c) => c.name);

test("good opportunities pass every check", () => {
  const r = checkOpportunities(goodOpps, oppExpect);
  assert.deepEqual(failingO(r), []);
  assert.ok(allPass(r));
});

test("opps: wave-3 without lower-wave prerequisite fails (none, or same wave)", () => {
  const none = { ...goodOpps, opportunities: [opp("o1", 1, []), opp("o3", 3, [])] };
  assert.deepEqual(failingO(checkOpportunities(none, oppExpect)), ["opps: wave-3 has a lower-wave prerequisite"]);
  const same = { ...goodOpps, opportunities: [opp("o1", 1, []), opp("o3", 3, []), opp("o4", 3, ["o3"])] };
  assert.ok(failingO(checkOpportunities(same, oppExpect)).includes("opps: wave-3 has a lower-wave prerequisite"));
});

test("opps: wave-1 required only when data score is low", () => {
  const noW1 = { ...goodOpps, opportunities: [opp("o2", 2, []), opp("o3", 3, ["o2"])] };
  assert.deepEqual(failingO(checkOpportunities(noW1, oppExpect)), ["opps: wave-1 exists (data score low)"]);
  assert.deepEqual(failingO(checkOpportunities(noW1, { ...oppExpect, lowDataScore: false })), []);
});

test("opps: currency in any agent text fails", () => {
  for (const sub of [
    { ...goodOpps, opportunities: [{ ...opp("o1", 1, []), rationale: "Economia de R$ 5 mil" }] },
    { ...goodOpps, enablement: [{ ...enab("e1", "dados"), rationale: "custa 300 reais" }, enab("e2", "ia")] },
    { ...goodOpps, expansion: [{ ...goodOpps.expansion[0]!, rationale: "BRL 10" }] },
  ]) {
    assert.ok(failingO(checkOpportunities(sub, oppExpect)).includes("opps: no currency in text"));
  }
  assert.equal(findCurrency(["sem moeda", "4 semanas"]), undefined);
});

test("currency regex flags amounts but not the adjective 'reais'", () => {
  for (const t of ["R$ 1.000", "1.000 reais", "2 mil reais", "BRL"]) assert.equal(findCurrency([t]), t, t);
  for (const t of ["custos reais", "dados reais", "R$ sem valor"]) assert.equal(findCurrency([t]), undefined, t);
});

test("opps: an empty submission fails exactly the at-least-one check when data score is not low", () => {
  const empty = { ...goodOpps, opportunities: [] };
  assert.deepEqual(failingO(checkOpportunities(empty, { ...oppExpect, lowDataScore: false })), ["opps: at least one opportunity"]);
});

test("opps: a prerequisite pointing at an unknown id does not satisfy wave 3", () => {
  const dangling = { ...goodOpps, opportunities: [opp("o1", 1, []), opp("o3", 3, ["ghost"])] };
  assert.deepEqual(failingO(checkOpportunities(dangling, oppExpect)), ["opps: wave-3 has a lower-wave prerequisite"]);
});

test("map: a map with zero steps fails the count, apps and keyword checks without throwing", () => {
  const r = checkMap({ steps: [], variants: [], confidence: "low" }, sessions, { ...mapExpect, expectVariants: false });
  assert.deepEqual(failing(r), ["map: step count in range", "map: key apps present", "map: step titles cover required keywords"]);
});

test("opps: squad limits (per opportunity and per wave) fail", () => {
  const six = ["a", "b", "c", "d", "e", "f"];
  const big = { ...goodOpps, opportunities: [opp("o1", 1, [], six)] };
  assert.deepEqual(failingO(checkOpportunities(big, oppExpect)), ["opps: squad size within limits"]);
  const perWave = {
    ...goodOpps,
    opportunities: [opp("o1", 1, [], ["a", "b", "c"]), { ...opp("o2", 1, [], ["d", "e", "f"]) }],
  };
  assert.ok(failingO(checkOpportunities(perWave, oppExpect)).includes("opps: squad size within limits"));
});

test("enablement: count and gap checks", () => {
  const one = { ...goodOpps, enablement: [enab("e1", "dados")] };
  assert.deepEqual(failingO(checkOpportunities(one, oppExpect)), ["enablement: 2-5 items"]);
  const six = { ...goodOpps, enablement: Array.from({ length: 6 }, (_, i) => enab(`e${i}`, "dados")) };
  assert.deepEqual(failingO(checkOpportunities(six, oppExpect)), ["enablement: 2-5 items"]);
  const wrongGap = { ...goodOpps, enablement: [enab("e1", "dados"), enab("e2", "ia")] };
  assert.deepEqual(failingO(checkOpportunities(wrongGap, oppExpect)), ["enablement: gap matches a weak dimension"]);
});

test("expansion: count and evidence checks", () => {
  const mk = (i: number) => ({ ...goodOpps.expansion[0]!, id: `x${i}` });
  const six = { ...goodOpps, expansion: Array.from({ length: 6 }, (_, i) => mk(i)) };
  assert.deepEqual(failingO(checkOpportunities(six, oppExpect)), ["expansion: 0-5 fronts"]);
  const generic = { ...goodOpps, expansion: [{ ...mk(0), evidence: ["Há muito retrabalho"] }] };
  assert.deepEqual(failingO(checkOpportunities(generic, oppExpect)), ["expansion: evidence mentions a recorded app/handoff"]);
  assert.deepEqual(failingO(checkOpportunities({ ...goodOpps, expansion: [] }, oppExpect)), []);
});
