import assert from "node:assert/strict";
import test from "node:test";

import type { Tool } from "@github/copilot-sdk";

import type { Analysis } from "../../common/analysis";
import type { Engagement, ProcessMap, ProcessMapSubmission } from "../../common/diagnostic";
import { MAP_INSTRUCTIONS, OPPORTUNITY_INSTRUCTIONS } from "./instructions";
import {
  buildMapTools,
  buildOpportunityTools,
  medianDurationFromRefs,
  type LinkedAnalysis,
} from "./tools";

async function invoke(tools: Tool[], name: string, args: unknown = {}): Promise<unknown> {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool?.handler);
  return tool.handler(args, { sessionId: "test", toolCallId: "test", toolName: name, arguments: args });
}

const text = (r: unknown): string => (typeof r === "string" ? r : (r as { textResultForLlm: string }).textResultForLlm);
const isFailure = (r: unknown): boolean => typeof r === "object" && r !== null && (r as { resultType?: string }).resultType === "failure";

const step = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: id, detail: "d", apps: [], evidence: [], confidence: "medium" as const, ...over,
});
const analyses: LinkedAnalysis[] = [
  {
    sessionId: "s1",
    analysis: {
      version: 1, sessionId: "s1", revision: 1, createdAt: 1, title: "T1", intent: "i", intentConfidence: "high",
      intentRationale: "", steps: [step("a", { startMs: 0, endMs: 100, apps: ["Excel", "Chrome"] }), step("b")], feedbackLog: [],
    } as unknown as Analysis,
  },
  {
    sessionId: "s2",
    analysis: {
      version: 1, sessionId: "s2", revision: 1, createdAt: 1, title: "T2", intent: "i", intentConfidence: "high",
      intentRationale: "", steps: [step("a", { startMs: 10, endMs: 410, apps: ["Excel"] })], feedbackLog: [],
    } as unknown as Analysis,
  },
];

const mapStep = (over: Record<string, unknown> = {}) => ({
  id: "m1", title: "Passo", dataStructure: "structured", manualTransfer: false, rework: false,
  medianDurationMs: 999999, apps: ["Fake"],
  sourceStepRefs: [{ sessionId: "s1", stepId: "a" }, { sessionId: "s2", stepId: "a" }],
  ...over,
});
const mapPayload = (steps: unknown[] = [mapStep()]) => ({ steps, variants: [], confidence: "high" });

test("medianDurationFromRefs: odd, even and missing timestamps", () => {
  const ref = (sessionId: string, stepId: string) => ({ sessionId, stepId });
  assert.equal(medianDurationFromRefs([ref("s1", "a")], analyses), 100);
  assert.equal(medianDurationFromRefs([ref("s1", "a"), ref("s2", "a")], analyses), 250);
  assert.equal(medianDurationFromRefs([ref("s1", "b")], analyses), null);
  assert.equal(medianDurationFromRefs([], analyses), null);
  assert.equal(medianDurationFromRefs([ref("zz", "a")], analyses), null);
});

test("medianDurationFromRefs: dedupes refs and ignores negative durations", () => {
  const ref = (sessionId: string, stepId: string) => ({ sessionId, stepId });
  // duplicates would skew toward 100 if counted: [100,100,400] -> 100; deduped [100,400] -> 250
  assert.equal(medianDurationFromRefs([ref("s1", "a"), ref("s1", "a"), ref("s2", "a")], analyses), 250);
  const neg: LinkedAnalysis[] = [{
    sessionId: "n",
    analysis: { steps: [step("x", { startMs: 500, endMs: 100 }), step("y", { startMs: 0, endMs: 40 })] } as unknown as Analysis,
  }];
  assert.equal(medianDurationFromRefs([ref("n", "x")], neg), null);
  assert.equal(medianDurationFromRefs([ref("n", "x"), ref("n", "y")], neg), 40);
});

test("submit_process_map: step without sourceStepRefs is rejected", async () => {
  let calls = 0;
  const tools = buildMapTools({ analyses, onSubmit: () => { calls++; } });
  const r = await invoke(tools, "submit_process_map", mapPayload([mapStep({ sourceStepRefs: [] })]));
  assert.ok(isFailure(r));
  assert.match(text(r), /sourceStepRefs/);
  assert.equal(calls, 0);
  assert.match(MAP_INSTRUCTIONS, /ao menos um item em sourceStepRefs/);
});

test("get_analyses returns steps with apps and durations", async () => {
  const tools = buildMapTools({ analyses, onSubmit: () => {} });
  const out = JSON.parse(text(await invoke(tools, "get_analyses")));
  assert.equal(out.length, 2);
  assert.equal(out[0].steps[0].durationMs, 100);
  assert.deepEqual(out[0].steps[0].apps, ["Excel", "Chrome"]);
});

test("submit_process_map: invalid payload returns the Zod path and does not submit", async () => {
  let calls = 0;
  const tools = buildMapTools({ analyses, onSubmit: () => { calls++; } });
  const r = await invoke(tools, "submit_process_map", { steps: [{ id: "m1" }], confidence: "high" });
  assert.ok(isFailure(r));
  assert.match(text(r), /steps\.0\.title/);
  assert.equal(calls, 0);
});

test("submit_process_map: unknown session, unknown step and duplicate ids are rejected", async () => {
  let calls = 0;
  const tools = buildMapTools({ analyses, onSubmit: () => { calls++; } });
  const bad1 = await invoke(tools, "submit_process_map", mapPayload([mapStep({ sourceStepRefs: [{ sessionId: "nope", stepId: "a" }] })]));
  assert.ok(isFailure(bad1));
  assert.match(text(bad1), /nope/);
  const bad2 = await invoke(tools, "submit_process_map", mapPayload([mapStep({ sourceStepRefs: [{ sessionId: "s1", stepId: "zzz" }] })]));
  assert.ok(isFailure(bad2));
  assert.match(text(bad2), /zzz/);
  const bad3 = await invoke(tools, "submit_process_map", mapPayload([mapStep(), mapStep()]));
  assert.ok(isFailure(bad3));
  assert.equal(calls, 0);
});

test("submit_process_map: valid payload submits once with duration and apps recomputed in code", async () => {
  const got: ProcessMapSubmission[] = [];
  const tools = buildMapTools({ analyses, onSubmit: (s) => got.push(s) });
  const r = await invoke(tools, "submit_process_map", mapPayload());
  assert.ok(!isFailure(r));
  assert.equal(got.length, 1);
  assert.equal(got[0].steps[0].medianDurationMs, 250);
  assert.deepEqual(got[0].steps[0].apps, ["Chrome", "Excel"]);
  // refs without timestamps -> null duration, apps still recomputed (none here)
  const none = await invoke(tools, "submit_process_map", mapPayload([mapStep({ sourceStepRefs: [{ sessionId: "s1", stepId: "b" }] })]));
  assert.ok(!isFailure(none));
  assert.equal(got[1].steps[0].medianDurationMs, null);
  assert.deepEqual(got[1].steps[0].apps, []);
});

const engagement: Engagement = {
  version: 1, id: "e1", clientName: "ACME", createdAt: 1, currency: "BRL", squadRates: [],
  roles: [{ id: "r1", name: "Analista", hourlyCost: 123.45 }],
  dataQuestionnaire: {},
  processes: [
    { id: "p1", name: "P1", sessionIds: ["s1"], roleId: "r1", stale: false },
    { id: "p2", name: "P2", sessionIds: [], stale: false },
  ],
  thesisText: "tese",
};
const pmap: ProcessMap = {
  version: 1, processId: "p1", revision: 1, createdAt: 1, confidence: "high", variants: [],
  steps: [{
    id: "m1", title: "Passo", medianDurationMs: 100, apps: [], dataArtifacts: [], dataStructure: "structured",
    manualTransfer: false, rework: false, sourceStepRefs: [],
  }],
};

const opp = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: id, processId: "p1", stepIds: ["m1"], wave: 1, prerequisites: [],
  estimatedSavingsPct: { value: 0.2, source: "ai-suggested" }, effort: "S", risk: "low",
  rationale: "r", suggestedSquad: { roles: ["Dev"], weeks: 2 }, ...over,
});

function oppTools() {
  const got: unknown[] = [];
  const tools = buildOpportunityTools({ engagement, maps: { p1: pmap }, onSubmit: (s) => got.push(s) });
  return { tools, got };
}

test("get_diagnostic_context contains no money", async () => {
  const { tools } = oppTools();
  const out = text(await invoke(tools, "get_diagnostic_context"));
  assert.ok(!out.includes("hourlyCost"));
  assert.ok(!out.includes("123.45"));
  assert.match(out, /Analista/);
  assert.match(out, /tese/);
});

test("submit_opportunities: valid submission is accepted; invalid schema rejected", async () => {
  const { tools, got } = oppTools();
  const ok = await invoke(tools, "submit_opportunities", { opportunities: [opp("o1"), opp("o2", { wave: 2, prerequisites: ["o1"] })] });
  assert.ok(!isFailure(ok));
  assert.equal(got.length, 1);
  const bad = await invoke(tools, "submit_opportunities", { opportunities: [{ id: "x" }] });
  assert.ok(isFailure(bad));
  assert.match(text(bad), /opportunities\.0\.title/);
  assert.equal(got.length, 1);
});

test("submit_opportunities: cycle returns the validateOpportunities error", async () => {
  const { tools, got } = oppTools();
  const r = await invoke(tools, "submit_opportunities", {
    opportunities: [opp("o1", { prerequisites: ["o2"] }), opp("o2", { prerequisites: ["o1"] })],
  });
  assert.ok(isFailure(r));
  assert.match(text(r), /Ciclo de pré-requisitos/);
  assert.equal(got.length, 0);
});

test("submit_opportunities: wave 3 needs a lower-wave prerequisite", async () => {
  const { tools, got } = oppTools();
  const none = await invoke(tools, "submit_opportunities", { opportunities: [opp("o3", { wave: 3 })] });
  assert.ok(isFailure(none));
  assert.match(text(none), /onda 3/);
  const sameWave = await invoke(tools, "submit_opportunities", {
    opportunities: [opp("o4", { wave: 3 }), opp("o5", { wave: 3, prerequisites: ["o4"] })],
  });
  assert.ok(isFailure(sameWave));
  const fine = await invoke(tools, "submit_opportunities", {
    opportunities: [opp("o1", { wave: 2 }), opp("o3", { wave: 3, prerequisites: ["o1"] })],
  });
  assert.ok(!isFailure(fine));
  assert.equal(got.length, 1);
});

test("submit_opportunities: unknown process or unmapped step is rejected", async () => {
  const { tools, got } = oppTools();
  const noProc = await invoke(tools, "submit_opportunities", { opportunities: [opp("o1", { processId: "ghost" })] });
  assert.ok(isFailure(noProc));
  assert.match(text(noProc), /ghost/);
  const noStep = await invoke(tools, "submit_opportunities", { opportunities: [opp("o1", { stepIds: ["m9"] })] });
  assert.ok(isFailure(noStep));
  assert.match(text(noStep), /m9/);
  const noMap = await invoke(tools, "submit_opportunities", { opportunities: [opp("o1", { processId: "p2" })] });
  assert.ok(isFailure(noMap));
  assert.equal(got.length, 0);
});

test("instructions: pt-BR, ordering rule present, no model identifiers", () => {
  assert.match(OPPORTUNITY_INSTRUCTIONS, /dados → automação → IA/);
  assert.match(OPPORTUNITY_INSTRUCTIONS, /onda 3/);
  assert.match(OPPORTUNITY_INSTRUCTIONS, /Nunca produza valores monetários/);
  assert.match(MAP_INSTRUCTIONS, /Nunca informe valores monetários/);
  for (const t of [MAP_INSTRUCTIONS, OPPORTUNITY_INSTRUCTIONS]) assert.ok(!/gpt|claude|gemini/i.test(t));
});

test("submit_process_map: agent may omit medianDurationMs", async () => {
  const got: ProcessMapSubmission[] = [];
  const tools = buildMapTools({ analyses, onSubmit: (s) => got.push(s) });
  const { medianDurationMs: _ignored, ...noDuration } = mapStep();
  const r = await invoke(tools, "submit_process_map", mapPayload([noDuration]));
  assert.ok(!isFailure(r), text(r));
  assert.equal(got[0].steps[0].medianDurationMs, 250);
});

test("submit_opportunities: a wave needing 6 distinct roles is rejected with text for the agent", async () => {
  const { tools, got } = oppTools();
  const r = await invoke(tools, "submit_opportunities", {
    opportunities: [
      opp("o1", { suggestedSquad: { roles: ["a", "b", "c"], weeks: 1 } }),
      opp("o2", { suggestedSquad: { roles: ["d", "e", "f"], weeks: 1 } }),
    ],
  });
  assert.ok(isFailure(r));
  assert.match(text(r), /submit_opportunities rejeitado/);
  assert.match(text(r), /5/);
  assert.equal(got.length, 0);
});

test("submit_opportunities: enablement and expansion are validated and passed through", async () => {
  const { tools, got } = oppTools();
  const enablement = [{ id: "c1", title: "Letramento", format: "letramento", audience: "Liderança", gap: "ia", rationale: "r", durationDays: 2 }];
  const expansion = [{ id: "x1", area: "Compras", rationale: "r", evidence: ["SAP visto"], relatedApps: ["SAP"] }];
  const bad = await invoke(tools, "submit_opportunities", { opportunities: [opp("o1")], enablement: [{ ...enablement[0], format: "palestra" }] });
  assert.ok(isFailure(bad));
  assert.match(text(bad), /enablement\.0\.format/);
  const ok = await invoke(tools, "submit_opportunities", { opportunities: [opp("o1")], enablement, expansion });
  assert.ok(!isFailure(ok), text(ok));
  assert.equal(got.length, 1);
  const sub = got[0] as { enablement: unknown[]; expansion: unknown[] };
  assert.equal(sub.enablement.length, 1);
  assert.equal(sub.expansion.length, 1);
});

test("get_diagnostic_context returns the three scores and observed apps, still no money", async () => {
  const tools = buildOpportunityTools({
    engagement,
    maps: { p1: { ...pmap, steps: [{ ...pmap.steps[0]!, apps: ["SAP", "Excel"] }] } },
    onSubmit: () => undefined,
  });
  const ctx = JSON.parse(text(await invoke(tools, "get_diagnostic_context")));
  assert.deepEqual(Object.keys(ctx.scores).sort(), ["ai", "data", "process"]);
  assert.deepEqual(ctx.processes[0].observedApps, ["Excel", "SAP"]);
  assert.ok(!JSON.stringify(ctx).includes("123.45"));
});

test("instructions: squad cap, enablement and expansion rules", () => {
  assert.match(OPPORTUNITY_INSTRUCTIONS, /5 pessoas/);
  assert.match(OPPORTUNITY_INSTRUCTIONS, /enablement/);
  assert.match(OPPORTUNITY_INSTRUCTIONS, /expansion/);
  assert.match(OPPORTUNITY_INSTRUCTIONS, /letramento em IA/i);
});

test("get_diagnostic_context lists the squad role names that have a rate, never the rates", async () => {
  const tools = buildOpportunityTools({
    engagement: {
      ...engagement,
      squadRates: [{ role: "Engenheiro de IA", weeklyRate: 7654.32 }, { role: "engenheiro de ia ", weeklyRate: 1 }, { role: "Analista de dados", weeklyRate: 4321 }],
      enablementDayRate: 987.65,
    },
    maps: { p1: pmap },
    onSubmit: () => undefined,
  });
  const raw = text(await invoke(tools, "get_diagnostic_context"));
  const ctx = JSON.parse(raw);
  assert.deepEqual(ctx.squadRoleCatalog, ["Engenheiro de IA", "Analista de dados"]);
  for (const n of ["7654", "4321", "987", "weeklyRate", "enablementDayRate", "squadRates"]) assert.ok(!raw.includes(n), n);
  const empty = JSON.parse(text(await invoke(oppTools().tools, "get_diagnostic_context")));
  assert.deepEqual(empty.squadRoleCatalog, []);
});

test("instructions: reuse the catalog role names exactly and never invent rates", () => {
  assert.match(OPPORTUNITY_INSTRUCTIONS, /squadRoleCatalog/);
  assert.match(OPPORTUNITY_INSTRUCTIONS, /nunca devem ser estimados/);
});
