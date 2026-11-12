// Optional LLM-as-judge for the diagnostic evals (`--judge`). The deterministic checks in
// checks.ts are the primary signal; this adds a 1-5 rubric where judgment is needed.
// Same plumbing as evals/judge.ts: a throwaway Copilot session with one submit tool.

import { approveAll, CopilotClient, type Tool } from "@github/copilot-sdk";

import type { Opportunity, ProcessMap, Enablement, Expansion } from "../../common/diagnostic";
import type { DiagnosticScenario } from "./scenario";

export const RUBRIC_KEYS = ["mapFaithfulness", "opportunityRationale", "enablementRelevance", "ptBrClarity"] as const;
export type RubricKey = (typeof RUBRIC_KEYS)[number];

export interface DiagnosticJudgeResult {
  scores: Record<RubricKey, number>;
  mean: number;
  notes: string;
}

const INSTRUCTIONS = `
You are grading an AI consulting assistant. It received recordings of how a client
executes a business process, and produced (1) a consolidated process map and (2) a
prioritised list of automation/AI opportunities, enablement items and expansion fronts,
for a client executive in pt-BR. Score each criterion from 1 (poor) to 5 (excellent):
- mapFaithfulness: the map faithfully merges the recordings; no invented steps, no lost
  steps, variants described correctly.
- opportunityRationale: each rationale is concrete and follows the thesis "dados -> automacao -> IA"
  (fix data first, then automate, then apply AI); waves and prerequisites make sense.
- enablementRelevance: enablement items address the client's real gaps (processos, dados, ia).
- ptBrClarity: the pt-BR text is clear, natural and appropriate for a client executive
  (no jargon walls, no money figures, no English leftovers).
Then call submit_judgement exactly once. Do not reply with prose.
`.trim();

export function renderJudgePrompt(
  scenario: DiagnosticScenario,
  map: ProcessMap,
  opps: Opportunity[],
  enablement: Enablement[],
  expansion: Expansion[],
): string {
  const recordings = scenario.analyses
    .map((a) => `Gravação ${a.sessionId} — ${a.intent}\n${a.steps.map((s, i) => `  ${i + 1}. [${s.id}] ${s.title} (${s.apps.join(", ")})`).join("\n")}`)
    .join("\n\n");
  return [
    `GROUND TRUTH:\n${scenario.truth}`,
    `RECORDINGS:\n${recordings}`,
    `PROCESS MAP:\n${JSON.stringify({ steps: map.steps, variants: map.variants, confidence: map.confidence }, null, 1)}`,
    `OPPORTUNITIES:\n${JSON.stringify(opps.map((o) => ({ id: o.id, title: o.title, wave: o.wave, prerequisites: o.prerequisites, rationale: o.rationale, squad: o.suggestedSquad })), null, 1)}`,
    `ENABLEMENT:\n${JSON.stringify(enablement.map((e) => ({ title: e.title, gap: e.gap, audience: e.audience, rationale: e.rationale })), null, 1)}`,
    `EXPANSION:\n${JSON.stringify(expansion.map((x) => ({ area: x.area, rationale: x.rationale, evidence: x.evidence })), null, 1)}`,
    `Score the four criteria from 1 to 5, then call submit_judgement.`,
  ].join("\n\n");
}

export async function judgeDiagnostic(
  scenario: DiagnosticScenario,
  map: ProcessMap,
  opps: Opportunity[],
  enablement: Enablement[],
  expansion: Expansion[],
  model?: string,
): Promise<DiagnosticJudgeResult> {
  const client = new CopilotClient();
  await client.start();
  try {
    const holder: { result: DiagnosticJudgeResult | undefined } = { result: undefined };
    const clamp = (v: unknown) => Math.max(1, Math.min(5, Number(v) || 1));
    const submit: Tool = {
      name: "submit_judgement",
      description: "Submit the 1-5 rubric scores.",
      parameters: {
        type: "object",
        properties: {
          ...Object.fromEntries(RUBRIC_KEYS.map((k) => [k, { type: "number", description: `1-5 score for ${k}.` }])),
          notes: { type: "string", description: "1-3 sentences justifying the lowest score." },
        },
        required: [...RUBRIC_KEYS],
        additionalProperties: false,
      },
      handler: (raw) => {
        const r = (raw ?? {}) as Record<string, unknown>;
        const scores = Object.fromEntries(RUBRIC_KEYS.map((k) => [k, clamp(r[k])])) as Record<RubricKey, number>;
        const mean = RUBRIC_KEYS.reduce((n, k) => n + scores[k], 0) / RUBRIC_KEYS.length;
        holder.result = { scores, mean, notes: typeof r.notes === "string" ? r.notes : "" };
        return "Judgement recorded.";
      },
    };
    const session = await client.createSession({
      systemMessage: { mode: "append", content: INSTRUCTIONS },
      tools: [submit],
      onPermissionRequest: approveAll,
      enableHostGitOperations: false,
      infiniteSessions: { enabled: false },
      ...(model ? { model } : {}),
    });
    await session.sendAndWait(renderJudgePrompt(scenario, map, opps, enablement, expansion), 120_000);
    await session.disconnect().catch(() => undefined);
    if (!holder.result) throw new Error("judge did not submit scores");
    return holder.result;
  } finally {
    await client.stop().catch(() => undefined);
  }
}
