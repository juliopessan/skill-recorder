// Pure helpers for the Diagnósticos view. No React, no bridge: unit-tested in isolation.
import type {
  DataQuestionnaire,
  Engagement,
  Opportunity,
  Process,
  ProcessMap,
  QuestionnaireAxis,
  SourcedNumber,
  SquadRate,
} from "../common/diagnostic";
import { MAX_RATE } from "../common/diagnostic-config";
import { roleKey, squadByWave } from "../common/diagnostic-roles";
import type { ReportInvestment } from "../common/diagnostic-report";

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

/** Anything the consultant can reorder and hide: opportunities, enablement, expansion. */
export type Orderable = { id: string; order: number; hidden: boolean };

export function ordered<T extends Orderable>(opps: T[]): T[] {
  return [...opps].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Moves one opportunity a step up (-1) or down (+1) and renumbers `order` as 0..n-1. */
export function moveOpportunity<T extends Orderable>(opps: T[], id: string, direction: -1 | 1): T[] {
  const list = ordered(opps);
  const from = list.findIndex((o) => o.id === id);
  const to = from + direction;
  if (from >= 0 && to >= 0 && to < list.length) {
    [list[from], list[to]] = [list[to], list[from]];
  }
  return list.map((o, i) => ({ ...o, order: i }));
}

export function setOpportunityHidden<T extends Orderable>(opps: T[], id: string, hidden: boolean): T[] {
  return opps.map((o) => (o.id === id ? { ...o, hidden } : o));
}

export function newId(prefix: string): string {
  const rand = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${rand.slice(0, 8)}`;
}

/** Parses a user-typed non-negative number (comma or dot decimals); null when empty or invalid. */
export function parseNonNegative(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface SquadRateRow {
  role: string;
  /** null = not informed. */
  weeklyRate: number | null;
  /** False for a saved rate whose role no visible opportunity uses any more. */
  inUse: boolean;
}

/**
 * Every distinct squad role of the visible opportunities (wave order, first spelling), each with its
 * saved rate if any, followed by saved rates for roles no longer in use so they stay editable.
 */
export function squadRateRows(opps: Opportunity[], rates: SquadRate[]): SquadRateRow[] {
  const saved = new Map<string, SquadRate>();
  for (const r of rates) if (!saved.has(roleKey(r.role))) saved.set(roleKey(r.role), r);
  const seen = new Set<string>();
  const rows: SquadRateRow[] = [];
  for (const w of squadByWave(opps)) {
    for (const role of w.roles) {
      const k = roleKey(role);
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ role, weeklyRate: saved.get(k)?.weeklyRate ?? null, inUse: true });
    }
  }
  for (const r of saved.values()) {
    if (!seen.has(roleKey(r.role))) rows.push({ role: r.role.trim(), weeklyRate: r.weeklyRate, inUse: false });
  }
  return rows;
}

/** Sets (or, with null, clears) the weekly rate of a role, matching case-insensitively. Pure; used inside persist updaters. */
export function setSquadRate(rates: SquadRate[], role: string, weeklyRate: number | null): SquadRate[] {
  const k = roleKey(role);
  const matches = (r: SquadRate): boolean => roleKey(r.role) === k;
  if (weeklyRate === null) return rates.filter((r) => !matches(r));
  if (!rates.some(matches)) return [...rates, { role: role.trim(), weeklyRate }];
  let done = false;
  return rates.flatMap((r) => {
    if (!matches(r)) return [r];
    if (done) return []; // collapse duplicates of the same role
    done = true;
    return [{ role: r.role, weeklyRate }];
  });
}

export const PAYBACK_WARNING = "Payback acima de 36 meses: revise escopo, volume ou preço antes de apresentar.";
export const NEGATIVE_RESULT_WARNING = "Resultado em 36 meses negativo: revise escopo, volume ou preço antes de apresentar.";

/** Consultant-only warning (never in the client report); null when there is nothing to warn about. */
export function squadReturnWarning(inv: Pick<ReportInvestment, "paybackOverCap" | "netOver36Months">): string | null {
  if (inv.paybackOverCap) return PAYBACK_WARNING;
  if (inv.netOver36Months !== null && inv.netOver36Months < 0) return NEGATIVE_RESULT_WARNING;
  return null;
}

export const NUMBER_ERROR = "Informe um número maior ou igual a zero.";
export const RATE_MAX_ERROR = `Informe um valor de até ${MAX_RATE.toLocaleString("pt-BR")}.`;

/** Rate input: a blank field is valid (it means "not informed"); otherwise a number from 0 to MAX_RATE. */
export const validateOptionalRate = (text: string): string | null => {
  if (text.trim() === "") return null;
  const n = parseNonNegative(text);
  if (n === null) return NUMBER_ERROR;
  return n > MAX_RATE ? RATE_MAX_ERROR : null;
};

export const SAVE_FAILED_MESSAGE = "Não foi possível salvar as alterações. Tente novamente.";

export interface UpdateQueue<T> {
  /**
   * Applies `update` to the latest value (optimistically, synchronously) and saves it after every
   * earlier save finished. Resolves to an error message, or null when the save succeeded.
   */
  enqueue(update: (prev: T) => T): Promise<string | null>;
  /** Adopts a value loaded from the store, unless local edits are still waiting to be saved. */
  sync(value: T): void;
  get(): T;
  pending(): number;
}

/**
 * Serialises edits so none is lost: every updater runs against the newest value (not a render-time
 * snapshot), and saves go out one at a time. A failed save reports its error but keeps the edits,
 * so later saves still carry them.
 */
export function createUpdateQueue<T>(initial: T, save: (value: T) => Promise<string | null>): UpdateQueue<T> {
  let current = initial;
  let pending = 0;
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue(update) {
      current = update(current);
      pending++;
      const run = async (): Promise<string | null> => {
        let error: string | null;
        try {
          error = await save(current);
        } catch {
          error = SAVE_FAILED_MESSAGE;
        }
        pending--;
        return error;
      };
      const task = tail.then(run, run);
      tail = task;
      return task;
    },
    sync(value) {
      if (pending === 0) current = value;
    },
    get: () => current,
    pending: () => pending,
  };
}
