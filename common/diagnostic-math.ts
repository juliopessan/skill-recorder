import { DIAGNOSTIC_CONFIG } from "./diagnostic-config";
import type {
  DataQuestionnaire,
  Opportunity,
  Process,
  ProcessMap,
  ProcessMapStep,
  Role,
} from "./diagnostic";

const MS_PER_HOUR = 3_600_000;

const money = (n: number): number => Math.round(n * 100) / 100;
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
