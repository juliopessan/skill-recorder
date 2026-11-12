// Scenario model for the diagnostic evals. Video-less and synthetic: the inputs are
// finished `Analysis` objects (what the describer would have produced) plus an
// Engagement, so only the two diagnostic LLM turns carry variance.

import type { Analysis } from "../../common/analysis";
import type { Engagement } from "../../common/diagnostic";
import type { MapExpect, OppExpect } from "./checks";

export interface DiagnosticScenario {
  id: string;
  title: string;
  /** Ground truth for the LLM judge (pt-BR). */
  truth: string;
  analyses: Analysis[];
  engagement: Engagement;
  /** The single process under test. */
  processId: string;
  mapExpect: MapExpect;
  /** `recordingTerms` is derived at run time from the analyses plus `handoffTerms`. */
  oppExpect: Omit<OppExpect, "recordingTerms">;
  /** Extra handoff terms (besides app names) that expansion evidence may cite. */
  handoffTerms: string[];
}

const T0 = Date.UTC(2026, 10, 2, 13, 0, 0);

export interface StepSpec {
  id: string;
  title: string;
  detail: string;
  apps: string[];
  /** Minutes from the session start. */
  from: number;
  to: number;
}

/** Build an Analysis the way the describer would persist it. */
export function makeAnalysis(sessionId: string, dayOffset: number, title: string, intent: string, steps: StepSpec[]): Analysis {
  const base = T0 + dayOffset * 86_400_000;
  return {
    version: 1,
    sessionId,
    revision: 1,
    createdAt: base,
    narrationSourceUpdatedAt: null,
    title,
    intent,
    intentConfidence: "high",
    intentRationale: "O fluxo repetido nas telas e nos arquivos abertos deixa o objetivo claro.",
    steps: steps.map((s) => ({
      id: s.id,
      title: s.title,
      detail: s.detail,
      startMs: base + s.from * 60_000,
      endMs: base + s.to * 60_000,
      apps: s.apps,
      evidence: [],
      confidence: "high" as const,
    })),
    feedbackLog: [],
    approved: true,
    approvedAt: base,
  };
}

export const ROLE_ID = "analista";

export function makeEngagement(
  id: string,
  clientName: string,
  processName: string,
  processId: string,
  sessionIds: string[],
  dataAnswers: { inventory: 1 | 2 | 3 | 4; structure: 1 | 2 | 3 | 4; quality: 1 | 2 | 3 | 4; access: 1 | 2 | 3 | 4; governance: 1 | 2 | 3 | 4 },
  volume: number,
  people: number,
): Engagement {
  const answer = (n: 1 | 2 | 3 | 4) => ({ answer: n, source: "confirmed" as const, evidence: [] });
  return {
    version: 1,
    id,
    clientName,
    createdAt: T0,
    currency: "BRL",
    roles: [{ id: ROLE_ID, name: "Analista financeiro", hourlyCost: 60 }],
    dataQuestionnaire: {
      inventory: answer(dataAnswers.inventory),
      structure: answer(dataAnswers.structure),
      quality: answer(dataAnswers.quality),
      access: answer(dataAnswers.access),
      governance: answer(dataAnswers.governance),
    },
    processes: [
      {
        id: processId,
        name: processName,
        sessionIds,
        roleId: ROLE_ID,
        volumePerMonth: { value: volume, source: "confirmed" },
        peopleCount: { value: people, source: "confirmed" },
        stale: false,
      },
    ],
    thesisText: "",
  };
}
