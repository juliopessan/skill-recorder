import type {
  DataQuestionnaire,
  Engagement,
  Opportunity,
  ProcessMap,
  QuestionnaireAnswer,
  QuestionnaireAxis,
} from "./diagnostic";
import { observedStructuredRatio } from "./diagnostic-math";

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Rejects unknown prerequisite ids, self references and cycles, naming the ids involved. */
export function validateOpportunities(opps: Opportunity[]): ValidationResult {
  const byId = new Map(opps.map((o) => [o.id, o]));
  for (const o of opps) {
    for (const p of o.prerequisites) {
      if (p === o.id) return { ok: false, error: `A oportunidade "${o.id}" não pode ser pré-requisito de si mesma.` };
      if (!byId.has(p)) {
        return { ok: false, error: `A oportunidade "${o.id}" depende de um pré-requisito desconhecido: "${p}".` };
      }
    }
  }
  const state = new Map<string, 1 | 2>(); // 1 = visiting, 2 = done
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const p of byId.get(id)!.prerequisites) {
      const cycle = visit(p);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const o of opps) {
    const cycle = visit(o.id);
    if (cycle) return { ok: false, error: `Ciclo de pré-requisitos: ${cycle.join(" -> ")}.` };
  }
  return { ok: true };
}

const AXIS_NAME: Record<QuestionnaireAxis, string> = {
  inventory: "Inventário",
  structure: "Estrutura",
  quality: "Qualidade",
  access: "Acesso",
  governance: "Governança",
};
const AXES = Object.keys(AXIS_NAME) as QuestionnaireAxis[];

/** Reasons (pt-BR) why the report must stay a draft. Empty when every number is trustworthy. */
export function draftReasons(e: Engagement, maps: Record<string, ProcessMap>): string[] {
  const reasons: string[] = [];
  const roles = new Map(e.roles.map((r) => [r.id, r]));
  for (const p of e.processes) {
    if (!maps[p.id]) reasons.push(`O processo "${p.name}" ainda não tem mapa.`);
    if (p.volumePerMonth?.source !== "confirmed") {
      reasons.push(`O volume mensal do processo "${p.name}" não foi confirmado.`);
    }
    if (p.peopleCount?.source !== "confirmed") {
      reasons.push(`O número de pessoas do processo "${p.name}" não foi confirmado.`);
    }
    const role = p.roleId ? roles.get(p.roleId) : undefined;
    if (!role) reasons.push(`O processo "${p.name}" não tem papel definido.`);
    else if (role.hourlyCost <= 0) reasons.push(`O papel "${role.name}" do processo "${p.name}" não tem custo/hora válido.`);
    if (p.stale) reasons.push(`O mapa do processo "${p.name}" está desatualizado.`);
  }
  for (const axis of AXES) {
    const a = e.dataQuestionnaire[axis];
    if (!a) reasons.push(`O eixo de dados "${AXIS_NAME[axis]}" do questionário não foi respondido.`);
    else if (a.source !== "confirmed") reasons.push(`A resposta do eixo de dados "${AXIS_NAME[axis]}" não foi confirmada.`);
  }
  return reasons;
}

/**
 * Quick win: small effort and nothing to wait for. A prerequisite is unresolved until delivered,
 * and delivery tracking is out of scope, so any opportunity with prerequisites is never a quick win.
 */
export function isQuickWin(opp: Opportunity, _all: Opportunity[]): boolean {
  return opp.effort === "S" && opp.prerequisites.length === 0;
}

/** Transitive prerequisites of `opp`, dependencies first (topological order). */
export function prerequisitePath(opp: Opportunity, all: Opportunity[]): Opportunity[] {
  const byId = new Map(all.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const out: Opportunity[] = [];
  const visit = (o: Opportunity): void => {
    for (const id of o.prerequisites) {
      const dep = byId.get(id);
      if (!dep || seen.has(id)) continue;
      seen.add(id);
      visit(dep);
      out.push(dep);
    }
  };
  seen.add(opp.id);
  visit(opp);
  return out;
}

const pct = (r: number): string => `${Math.round(r * 100)}%`;

function answer(r: number, label: string, inverse: boolean): QuestionnaireAnswer {
  const value = inverse
    ? r <= 0.25 ? 4 : r <= 0.5 ? 3 : r <= 0.75 ? 2 : 1
    : r >= 0.75 ? 4 : r >= 0.5 ? 3 : r >= 0.25 ? 2 : 1;
  return { answer: value, source: "ai-suggested", evidence: [`${pct(r)} ${label}`] };
}

/** Suggests structure/access/quality answers from observed maps; inventory and governance stay unanswered. */
export function suggestQuestionnaire(maps: ProcessMap[]): DataQuestionnaire {
  const steps = maps.flatMap((m) => m.steps);
  if (steps.length === 0) return {};
  const manual = steps.filter((s) => s.manualTransfer).length / steps.length;
  const rework = steps.filter((s) => s.rework).length / steps.length;
  return {
    structure: answer(observedStructuredRatio(maps), "dos passos observados têm dados estruturados", false),
    access: answer(manual, "dos passos exigem transferência manual de dados", true),
    quality: answer(rework, "dos passos envolvem retrabalho", true),
  };
}
