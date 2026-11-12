// Pure helpers for the Diagnósticos view. No React, no bridge: unit-tested in isolation.
import type {
  DataQuestionnaire,
  Engagement,
  Opportunity,
  Process,
  ProcessMap,
  QuestionnaireAxis,
  SourcedNumber,
} from "../common/diagnostic";

export const AXES: readonly QuestionnaireAxis[] = ["inventory", "structure", "quality", "access", "governance"];

export type DiagnosticStep = "roles" | "processes" | "questionnaire" | "maps" | "baseline" | "opportunities" | "report";

export const LOW_CONFIDENCE_REASON = "Baixa confiança: sem variação medida";

/** A map needs at least one linked session that has an analysis, and a process that is not stale. */
export function canGenerateMap(
  process: Process,
  sessionsWithApprovedAnalysis: ReadonlySet<string> | readonly string[],
): { ok: boolean; reason?: string } {
  const analyzed = new Set(sessionsWithApprovedAnalysis);
  if (process.stale) {
    return { ok: false, reason: "O mapa está desatualizado: regenere-o para refletir as gravações vinculadas." };
  }
  const usable = process.sessionIds.filter((id) => analyzed.has(id)).length;
  if (usable === 0) {
    return { ok: false, reason: "Vincule ao menos uma gravação analisada a este processo." };
  }
  if (usable === 1) return { ok: true, reason: LOW_CONFIDENCE_REASON };
  return { ok: true };
}

/** Marks a value as confirmed by the consultant, optionally replacing the number. */
export function confirmField(value: SourcedNumber, newValue?: number): SourcedNumber {
  return { value: newValue ?? value.value, source: "confirmed" };
}

function baselineDone(e: Engagement): boolean {
  const roles = new Map(e.roles.map((r) => [r.id, r]));
  return e.processes.every((p) => {
    const role = p.roleId ? roles.get(p.roleId) : undefined;
    return (
      !!role &&
      role.hourlyCost > 0 &&
      p.volumePerMonth?.source === "confirmed" &&
      p.peopleCount?.source === "confirmed"
    );
  });
}

/** The next unfinished stage of the diagnostic, in the order the consultant works through it. */
export function nextStep(e: Engagement, maps: Record<string, ProcessMap>, opps: Opportunity[]): DiagnosticStep {
  if (e.roles.length === 0) return "roles";
  if (e.processes.length === 0) return "processes";
  if (AXES.some((a) => e.dataQuestionnaire[a]?.source !== "confirmed")) return "questionnaire";
  if (e.processes.some((p) => !maps[p.id])) return "maps";
  if (!baselineDone(e)) return "baseline";
  if (opps.length === 0) return "opportunities";
  return "report";
}

/** Fills only the axes the consultant has not confirmed yet. */
export function mergeSuggestedQuestionnaire(current: DataQuestionnaire, suggested: DataQuestionnaire): DataQuestionnaire {
  const out: DataQuestionnaire = { ...current };
  for (const axis of AXES) {
    const s = suggested[axis];
    if (s && current[axis]?.source !== "confirmed") out[axis] = s;
  }
  return out;
}

function ordered(opps: Opportunity[]): Opportunity[] {
  return [...opps].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Moves one opportunity a step up (-1) or down (+1) and renumbers `order` as 0..n-1. */
export function moveOpportunity(opps: Opportunity[], id: string, direction: -1 | 1): Opportunity[] {
  const list = ordered(opps);
  const from = list.findIndex((o) => o.id === id);
  const to = from + direction;
  if (from >= 0 && to >= 0 && to < list.length) {
    [list[from], list[to]] = [list[to], list[from]];
  }
  return list.map((o, i) => ({ ...o, order: i }));
}

export function setOpportunityHidden(opps: Opportunity[], id: string, hidden: boolean): Opportunity[] {
  return opps.map((o) => (o.id === id ? { ...o, hidden } : o));
}

export function newId(prefix: string): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${rand.slice(0, 8)}`;
}
