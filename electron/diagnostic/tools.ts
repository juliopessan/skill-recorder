import type { Tool } from "@github/copilot-sdk";

import type { Analysis } from "../../common/analysis";
import {
  OpportunitiesSubmissionSchema,
  OpportunitySchema,
  ProcessMapSubmissionSchema,
  type Engagement,
  type Opportunity,
  type OpportunitiesSubmission,
  type ProcessMap,
  type ProcessMapSubmission,
} from "../../common/diagnostic";
import { validateOpportunities } from "../../common/diagnostic-rules";

export type LinkedAnalysis = { sessionId: string; analysis: Analysis };
type StepRef = { sessionId: string; stepId: string };

export const MAP_TOOL_NAMES = ["get_analyses", "submit_process_map"] as const;
export const OPPORTUNITY_TOOL_NAMES = ["get_diagnostic_context", "submit_opportunities"] as const;

const failure = (text: string) => ({ resultType: "failure" as const, textResultForLlm: text });

const zodText = (tool: string, error: { issues: { path: PropertyKey[]; message: string }[] }): string =>
  `${tool} rejeitado — o conteúdo não corresponde ao esquema. Corrija e chame novamente:\n` +
  error.issues.map((i) => `- ${i.path.map(String).join(".") || "(raiz)"}: ${i.message}`).join("\n");

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function findStep(refs: StepRef, analyses: LinkedAnalysis[]) {
  return analyses.find((a) => a.sessionId === refs.sessionId)?.analysis.steps.find((s) => s.id === refs.stepId);
}

/** Median of (endMs − startMs) of the referenced analysis steps that have both; null if none do. */
export function medianDurationFromRefs(refs: StepRef[], analyses: LinkedAnalysis[]): number | null {
  const durations: number[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = JSON.stringify([ref.sessionId, ref.stepId]);
    if (seen.has(key)) continue;
    seen.add(key);
    const step = findStep(ref, analyses);
    if (step?.startMs != null && step.endMs != null && step.endMs >= step.startMs) {
      durations.push(step.endMs - step.startMs);
    }
  }
  return durations.length ? median(durations) : null;
}

/** Sorted union of the apps of the referenced analysis steps. */
export function appsFromRefs(refs: StepRef[], analyses: LinkedAnalysis[]): string[] {
  const apps = new Set<string>();
  for (const ref of refs) for (const a of findStep(ref, analyses)?.apps ?? []) apps.add(a);
  return [...apps].sort();
}

/** Discards whatever the agent sent for duration/apps and recomputes both from the source steps. */
export function normalizeMapSubmission(s: ProcessMapSubmission, analyses: LinkedAnalysis[]): ProcessMapSubmission {
  return {
    ...s,
    steps: s.steps.map((st) => ({
      ...st,
      medianDurationMs: medianDurationFromRefs(st.sourceStepRefs, analyses),
      apps: appsFromRefs(st.sourceStepRefs, analyses),
    })),
  };
}

export interface MapToolContext {
  analyses: LinkedAnalysis[];
  onSubmit: (s: ProcessMapSubmission) => void;
}

export function buildMapTools(ctx: MapToolContext): Tool[] {
  const getAnalyses: Tool = {
    name: "get_analyses",
    description:
      "Retorna as análises das gravações vinculadas a este processo: título, intenção e passos (com apps e duração em ms quando conhecida). Use os ids de sessão e de passo exatamente como retornados em sourceStepRefs.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: () =>
      JSON.stringify(
        ctx.analyses.map(({ sessionId, analysis }) => ({
          sessionId,
          title: analysis.title,
          intent: analysis.intent,
          steps: analysis.steps.map((s) => ({
            id: s.id,
            title: s.title,
            detail: s.detail,
            apps: s.apps,
            durationMs: s.startMs != null && s.endMs != null ? s.endMs - s.startMs : null,
          })),
        })),
        null,
        2,
      ),
  };

  const submitProcessMap: Tool = {
    name: "submit_process_map",
    description:
      "Envie o mapa final do processo: passos mesclados entre as gravações, com classificação de estrutura de dados, transferência manual e retrabalho. Chame uma única vez quando estiver confiante. A duração mediana e os apps são recalculados pelo sistema a partir de sourceStepRefs.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: 'Id curto e estável, ex.: "m1".' },
              title: { type: "string" },
              medianDurationMs: { type: ["number", "null"], description: "Ignorado: recalculado pelo sistema." },
              apps: { type: "array", items: { type: "string" }, description: "Ignorado: recalculado pelo sistema." },
              dataArtifacts: { type: "array", items: { type: "string" }, description: "Documentos/dados tocados no passo." },
              dataStructure: { type: "string", enum: ["structured", "semi", "unstructured"] },
              manualTransfer: { type: "boolean", description: "Dados copiados/digitados manualmente entre sistemas." },
              rework: { type: "boolean" },
              owner: { type: "string" },
              sourceStepRefs: {
                type: "array",
                items: {
                  type: "object",
                  properties: { sessionId: { type: "string" }, stepId: { type: "string" } },
                  required: ["sessionId", "stepId"],
                  additionalProperties: false,
                },
              },
            },
            required: ["id", "title", "dataStructure", "manualTransfer", "rework", "sourceStepRefs"],
            additionalProperties: false,
          },
        },
        variants: {
          type: "array",
          items: {
            type: "object",
            properties: { stepId: { type: "string" }, description: { type: "string" } },
            required: ["stepId", "description"],
            additionalProperties: false,
          },
        },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["steps", "confidence"],
      additionalProperties: false,
    },
    handler: (raw) => {
      // medianDurationMs is discarded and recomputed, so the agent may omit it.
      const withDefaults =
        raw && typeof raw === "object" && Array.isArray((raw as { steps?: unknown }).steps)
          ? {
              ...(raw as object),
              steps: (raw as { steps: unknown[] }).steps.map((st) =>
                st && typeof st === "object" ? { medianDurationMs: null, ...(st as object) } : st,
              ),
            }
          : raw;
      const parsed = ProcessMapSubmissionSchema.safeParse(withDefaults);
      if (!parsed.success) return failure(zodText("submit_process_map", parsed.error));
      const sub = parsed.data;
      const ids = new Set<string>();
      for (const st of sub.steps) {
        if (ids.has(st.id)) return failure(`submit_process_map rejeitado — id de passo duplicado: "${st.id}".`);
        ids.add(st.id);
        if (st.sourceStepRefs.length === 0) {
          return failure(
            `submit_process_map rejeitado — o passo "${st.id}" não tem sourceStepRefs; todo passo do mapa deve se basear em ao menos um passo gravado.`,
          );
        }
        for (const ref of st.sourceStepRefs) {
          const session = ctx.analyses.find((a) => a.sessionId === ref.sessionId);
          if (!session) {
            return failure(`submit_process_map rejeitado — o passo "${st.id}" referencia uma sessão desconhecida: "${ref.sessionId}".`);
          }
          if (!session.analysis.steps.some((s) => s.id === ref.stepId)) {
            return failure(
              `submit_process_map rejeitado — o passo "${st.id}" referencia um passo desconhecido "${ref.stepId}" na sessão "${ref.sessionId}".`,
            );
          }
        }
      }
      for (const v of sub.variants) {
        if (!ids.has(v.stepId)) {
          return failure(`submit_process_map rejeitado — a variante referencia um passo desconhecido: "${v.stepId}".`);
        }
      }
      ctx.onSubmit(normalizeMapSubmission(sub, ctx.analyses));
      return "Mapa registrado. Você pode parar agora.";
    },
  };

  return [getAnalyses, submitProcessMap];
}

export interface OpportunityToolContext {
  engagement: Engagement;
  maps: Record<string, ProcessMap>;
  onSubmit: (s: OpportunitiesSubmission) => void;
}

export function buildOpportunityTools(ctx: OpportunityToolContext): Tool[] {
  const getContext: Tool = {
    name: "get_diagnostic_context",
    description:
      "Retorna o contexto do diagnóstico: processos, mapas de processo, questionário de dados, papéis (sem valores monetários) e a tese do cliente.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: () => {
      const e = ctx.engagement;
      return JSON.stringify(
        {
          clientName: e.clientName,
          thesisText: e.thesisText,
          roles: e.roles.map((r) => ({ id: r.id, name: r.name })),
          dataQuestionnaire: e.dataQuestionnaire,
          processes: e.processes.map((p) => ({
            id: p.id,
            name: p.name,
            owner: p.owner,
            roleId: p.roleId,
            volumePerMonth: p.volumePerMonth,
            peopleCount: p.peopleCount,
            map: ctx.maps[p.id] ?? null,
          })),
        },
        null,
        2,
      );
    },
  };

  const submitOpportunities: Tool = {
    name: "submit_opportunities",
    description:
      "Envie a lista final de oportunidades. Ordem obrigatória: dados (onda 1) → automação (onda 2) → IA (onda 3); toda oportunidade de onda 3 deve listar ao menos um pré-requisito de onda inferior. Chame uma única vez quando estiver confiante.",
    parameters: {
      type: "object",
      properties: {
        opportunities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              processId: { type: "string" },
              stepIds: { type: "array", items: { type: "string" } },
              wave: { type: "number", enum: [1, 2, 3] },
              prerequisites: { type: "array", items: { type: "string" }, description: "Ids de outras oportunidades." },
              estimatedSavingsPct: {
                type: "object",
                properties: {
                  value: { type: "number", description: "Fração entre 0 e 1." },
                  source: { type: "string", enum: ["ai-suggested"] },
                },
                required: ["value", "source"],
                additionalProperties: false,
              },
              effort: { type: "string", enum: ["S", "M", "L"] },
              risk: { type: "string", enum: ["low", "medium", "high"] },
              rationale: { type: "string" },
              suggestedSquad: {
                type: "object",
                properties: { roles: { type: "array", items: { type: "string" } }, weeks: { type: "number" } },
                required: ["roles", "weeks"],
                additionalProperties: false,
              },
            },
            required: [
              "id", "title", "processId", "stepIds", "wave", "estimatedSavingsPct",
              "effort", "risk", "rationale", "suggestedSquad",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["opportunities"],
      additionalProperties: false,
    },
    handler: (raw) => {
      const parsed = OpportunitiesSubmissionSchema.safeParse(raw);
      if (!parsed.success) return failure(zodText("submit_opportunities", parsed.error));
      const full: Opportunity[] = parsed.data.opportunities.map((o, order) =>
        OpportunitySchema.parse({ ...o, hidden: false, order }),
      );
      const valid = validateOpportunities(full);
      if (!valid.ok) return failure(`submit_opportunities rejeitado — ${valid.error}`);
      const byId = new Map(full.map((o) => [o.id, o]));
      for (const o of full) {
        const proc = ctx.engagement.processes.find((p) => p.id === o.processId);
        if (!proc) {
          return failure(`submit_opportunities rejeitado — a oportunidade "${o.id}" referencia um processo desconhecido: "${o.processId}".`);
        }
        const map = ctx.maps[o.processId];
        const known = new Set(map?.steps.map((s) => s.id) ?? []);
        for (const sid of o.stepIds) {
          if (!known.has(sid)) {
            return failure(
              `submit_opportunities rejeitado — a oportunidade "${o.id}" referencia o passo "${sid}", que não existe no mapa do processo "${o.processId}".`,
            );
          }
        }
        if (o.wave === 3 && !o.prerequisites.some((p) => (byId.get(p)?.wave ?? 3) < 3)) {
          return failure(
            `submit_opportunities rejeitado — a oportunidade "${o.id}" é de onda 3 (IA) e deve listar ao menos um pré-requisito de onda inferior (dados ou automação).`,
          );
        }
      }
      ctx.onSubmit(parsed.data);
      return "Oportunidades registradas. Você pode parar agora.";
    },
  };

  return [getContext, submitOpportunities];
}
