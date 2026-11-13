import { DIAGNOSTIC_CONFIG, MATURITY_LEVELS, PAYBACK_DISPLAY_CAP_MONTHS, WEEKS_PER_MONTH } from "./diagnostic-config";
import { roleKey, squadByWave } from "./diagnostic-roles";
import type {
  DataQuestionnaire,
  Enablement,
  Engagement,
  Opportunity,
  Process,
  ProcessMap,
  ProcessMapStep,
  Role,
  SquadRate,
} from "./diagnostic";

const MS_PER_HOUR = 3_600_000;

export const money = (n: number): number => Math.round(n * 100) / 100;
const score = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
const ratio = (count: number, total: number): number => (total === 0 ? 0 : count / total);

/** Monthly cost of one step; 0 when duration, volume or hourly cost is missing. */
export function stepMonthlyCost(step: ProcessMapStep, process: Process, role: Role | undefined): number {
  const volume = process.volumePerMonth?.value;
  const hourly = role?.hourlyCost;
  if (step.medianDurationMs == null || volume == null || hourly == null) return 0;
  return money((step.medianDurationMs / MS_PER_HOUR) * volume * hourly);
}

export function processMonthlyCost(map: ProcessMap, process: Process, role?: Role): number {
  return money(map.steps.reduce((sum, s) => sum + stepMonthlyCost(s, process, role), 0));
}

export function opportunitySavings(
  opp: Opportunity,
  map: ProcessMap,
  process: Process,
  role?: Role,
): { monthlyCostToday: number; monthlySavings: number; appliedPct: number; capped: boolean } {
  const ids = new Set(opp.stepIds);
  const monthlyCostToday = money(
    map.steps.filter((s) => ids.has(s.id)).reduce((sum, s) => sum + stepMonthlyCost(s, process, role), 0),
  );
  const cap = DIAGNOSTIC_CONFIG.waveCaps[opp.wave];
  const requested = opp.estimatedSavingsPct.value;
  const appliedPct = Math.min(requested, cap);
  return {
    monthlyCostToday,
    monthlySavings: money(monthlyCostToday * appliedPct),
    appliedPct,
    capped: requested > cap,
  };
}

export function processScore(map: ProcessMap): number {
  const p = DIAGNOSTIC_CONFIG.processPenalties;
  const n = map.steps.length;
  const manual = ratio(map.steps.filter((s) => s.manualTransfer).length, n);
  const rework = ratio(map.steps.filter((s) => s.rework).length, n);
  const unowned = ratio(map.steps.filter((s) => !s.owner).length, n);
  return score(
    100 -
      p.perVariant * map.variants.length -
      p.manualTransferRatio * manual -
      p.reworkRatio * rework -
      p.unownedRatio * unowned,
  );
}

export function observedStructuredRatio(maps: ProcessMap[]): number {
  const steps = maps.flatMap((m) => m.steps);
  return ratio(steps.filter((s) => s.dataStructure === "structured").length, steps.length);
}

export function dataScore(q: DataQuestionnaire, maps: ProcessMap[]): number {
  const answers = Object.values(q).filter((a) => a != null);
  const questionnaire = answers.length === 0 ? 0 : (answers.reduce((s, a) => s + (a.answer - 1) / 3, 0) / answers.length) * 100;
  const w = DIAGNOSTIC_CONFIG.dataWeights;
  return score(w.questionnaire * questionnaire + w.observed * observedStructuredRatio(maps) * 100);
}

export function aiReadinessScore(process: number, data: number): number {
  const w = DIAGNOSTIC_CONFIG.aiWeights;
  return score(w.min * Math.min(process, data) + w.mean * ((process + data) / 2));
}

export function opportunityReadiness(opp: Opportunity, processScoreValue: number, dataScoreValue: number): number {
  if (opp.wave === 1) return 100;
  if (opp.wave === 2) return score(processScoreValue);
  return aiReadinessScore(processScoreValue, dataScoreValue);
}

/** Integer mean of the per-process scores; 0 when there are no maps. */
export function overallProcessScore(maps: ProcessMap[]): number {
  if (maps.length === 0) return 0;
  return Math.round(maps.reduce((sum, m) => sum + processScore(m), 0) / maps.length);
}

/**
 * Total savings without double counting: opportunities that touch the same step are alternative
 * stages of one path (dados -> automação -> IA), so each step contributes only the largest saving
 * among them. A saving is step cost x min(requested pct, wave cap).
 */
export function aggregateSavings(opps: Opportunity[], maps: Record<string, ProcessMap>, engagement: Engagement): number {
  const processes = new Map(engagement.processes.map((p) => [p.id, p]));
  const roles = new Map(engagement.roles.map((r) => [r.id, r]));
  const best = new Map<string, number>();
  for (const o of opps) {
    const process = processes.get(o.processId);
    const map = maps[o.processId];
    if (!process || !map) continue;
    const role = process.roleId ? roles.get(process.roleId) : undefined;
    const pct = Math.min(o.estimatedSavingsPct.value, DIAGNOSTIC_CONFIG.waveCaps[o.wave]);
    const ids = new Set(o.stepIds);
    for (const s of map.steps) {
      if (!ids.has(s.id)) continue;
      const saving = money(stepMonthlyCost(s, process, role) * pct);
      const key = `${o.processId}\u0000${s.id}`;
      if (saving > (best.get(key) ?? 0)) best.set(key, saving);
    }
  }
  return money([...best.values()].reduce((a, b) => a + b, 0));
}

export interface AiMaturity {
  level: number;
  name: string;
  nextLevel: { level: number; name: string; pointsNeeded: number } | null;
}

/** AI maturity level (1–5) from the AI readiness score; points needed to reach the next level. */
export function aiMaturity(aiScore: number): AiMaturity {
  const s = Number.isFinite(aiScore) ? aiScore : 0;
  let idx = 0;
  MATURITY_LEVELS.forEach((l, i) => { if (s >= l.min) idx = i; });
  const cur = MATURITY_LEVELS[idx]!;
  const next = MATURITY_LEVELS[idx + 1];
  return {
    level: cur.level,
    name: cur.name,
    nextLevel: next ? { level: next.level, name: next.name, pointsNeeded: Math.max(0, Math.ceil(next.min - s)) } : null,
  };
}

/** The dimension holding AI readiness back; ties go to "dados". */
export function weakestDimension(processScoreValue: number, dataScoreValue: number): "processos" | "dados" {
  return processScoreValue < dataScoreValue ? "processos" : "dados";
}

// ---------------------------------------------------------------------------------------------
// Squad cost and return on investment. Rates come only from the consultant (Engagement.squadRates).
// ---------------------------------------------------------------------------------------------

const visibleInWave = (opps: Opportunity[], wave: 1 | 2 | 3): Opportunity[] =>
  opps.filter((o) => !o.hidden && o.wave === wave);
const safeWeeks = (o: Opportunity): number => (Number.isFinite(o.suggestedSquad.weeks) && o.suggestedSquad.weeks > 0 ? o.suggestedSquad.weeks : 0);

/** First rate wins when the same role (case-insensitive, trimmed) was entered twice. */
function rateByRole(rates: SquadRate[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rates) if (!m.has(roleKey(r.role))) m.set(roleKey(r.role), r.weeklyRate);
  return m;
}

/** Distinct roles of the visible opportunities (any wave) that have no rate, in wave order, first spelling. */
export function missingSquadRates(opps: Opportunity[], rates: SquadRate[]): string[] {
  const have = rateByRole(rates);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of squadByWave(opps)) {
    for (const role of w.roles) {
      const k = roleKey(role);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!have.has(k)) out.push(role);
    }
  }
  return out;
}

export interface WaveInvestment {
  wave: 1 | 2 | 3;
  roles: string[];
  /** Sum of the suggested weeks of the wave's visible opportunities (they run in sequence). */
  weeks: number;
  /** Σ over the wave's distinct roles of weeklyRate × weeks; null when any of those roles has no rate. */
  cost: number | null;
}

/** A wave's squad is booked for the whole wave: every role of the wave is paid for all of its weeks. */
export function waveInvestments(opps: Opportunity[], rates: SquadRate[]): WaveInvestment[] {
  const have = rateByRole(rates);
  return squadByWave(opps).map(({ wave, roles }) => {
    const weeks = visibleInWave(opps, wave).reduce((a, o) => a + safeWeeks(o), 0);
    const weekly = roles.map((r) => have.get(roleKey(r)));
    const raw = weekly.some((w) => w === undefined) ? null : (weekly as number[]).reduce((a, w) => a + w * weeks, 0);
    const cost = raw === null || !Number.isFinite(raw) ? null : money(raw);
    return { wave, roles, weeks, cost };
  });
}

/**
 * Investment allocated to each visible opportunity: the wave cost split pro rata by weeks. The last
 * opportunity of a wave takes the remainder so the cards add up to the wave cost to the cent.
 * Null for every opportunity of a wave whose cost is null.
 */
export function opportunityInvestments(opps: Opportunity[], rates: SquadRate[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const w of waveInvestments(opps, rates)) {
    const items = visibleInWave(opps, w.wave);
    if (w.cost === null) {
      for (const o of items) out.set(o.id, null);
      continue;
    }
    const lastIdx = items.reduce((idx, o, i) => (safeWeeks(o) > 0 ? i : idx), -1);
    let allocated = 0;
    items.forEach((o, i) => {
      let share = 0;
      if (w.weeks > 0 && safeWeeks(o) > 0) {
        share = i === lastIdx ? money(w.cost! - allocated) : money((w.cost! * safeWeeks(o)) / w.weeks);
      }
      allocated = money(allocated + share);
      out.set(o.id, share);
    });
  }
  return out;
}

export interface ProgramInvestment {
  waves: WaveInvestment[];
  missingRoles: string[];
  /** Σ wave costs; null as soon as one role lacks a rate (a partial cost would understate it). */
  squadCost: number | null;
  /** Σ visible durationDays × day rate; 0 when no day rate is set. */
  enablementCost: number;
  total: number | null;
}

export function programInvestment(
  opps: Opportunity[],
  rates: SquadRate[],
  enablement: Enablement[] = [],
  enablementDayRate?: number,
): ProgramInvestment {
  const waves = waveInvestments(opps, rates);
  const missingRoles = missingSquadRates(opps, rates);
  const squadCost = waves.some((w) => w.cost === null) ? null : money(waves.reduce((a, w) => a + (w.cost ?? 0), 0));
  const enablementCost =
    enablementDayRate !== undefined && Number.isFinite(enablementDayRate)
      ? money(enablement.filter((x) => !x.hidden).reduce((a, x) => a + x.durationDays * enablementDayRate, 0))
      : 0;
  const total = squadCost === null ? null : money(squadCost + enablementCost);
  return {
    waves,
    missingRoles,
    squadCost,
    enablementCost: Number.isFinite(enablementCost) ? enablementCost : 0,
    total: total !== null && Number.isFinite(total) && Number.isFinite(enablementCost) ? total : null,
  };
}

/** Simple payback in months (investment ÷ monthly savings); null without an investment or without savings. */
export function paybackMonths(investment: number | null, monthlySavings: number): number | null {
  if (investment === null || !Number.isFinite(investment) || !(monthlySavings > 0)) return null;
  return investment / monthlySavings;
}

export interface ProgramReturn {
  /** Months until every wave is delivered: total squad weeks ÷ (52 / 12). */
  deliveryMonths: number;
  /** Unrounded; null when the investment is unknown or savings are zero. */
  paybackMonths: number | null;
  /** True when payback is beyond the display cap (36 months). */
  paybackOverCap: boolean;
  /** max(0, 36 − deliveryMonths) × monthlySavings − investment; null when the investment is unknown. */
  netOver36Months: number | null;
}

/** Savings start after delivery; `monthlySavings` must come from `aggregateSavings` (never the naive sum). */
export function programReturn(investment: number | null, monthlySavings: number, totalWeeks: number): ProgramReturn {
  const weeks = Number.isFinite(totalWeeks) && totalWeeks > 0 ? totalWeeks : 0;
  const deliveryMonths = weeks / WEEKS_PER_MONTH;
  const payback = paybackMonths(investment, monthlySavings);
  const savings = Number.isFinite(monthlySavings) && monthlySavings > 0 ? monthlySavings : 0;
  return {
    deliveryMonths,
    paybackMonths: payback,
    paybackOverCap: payback !== null && payback > PAYBACK_DISPLAY_CAP_MONTHS,
    netOver36Months:
      investment === null || !Number.isFinite(investment)
        ? null
        : money(Math.max(0, PAYBACK_DISPLAY_CAP_MONTHS - deliveryMonths) * savings - investment),
  };
}
