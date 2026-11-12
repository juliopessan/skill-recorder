// Deterministic checks for the AI Readiness Diagnostic eval. Pure functions, no LLM,
// no I/O: they score the two LLM turns (process map, opportunities) against a
// scenario's expectations. Unit-tested in checks.test.ts.

import type { Analysis } from "../../common/analysis";
import type {
  Enablement,
  Opportunity,
  OpportunitiesSubmission,
  ProcessMapSubmission,
} from "../../common/diagnostic";
import { validateSquadSize } from "../../common/diagnostic-rules";

export interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export type Gap = Enablement["gap"];

export interface MapExpect {
  minSteps: number;
  maxSteps: number;
  /** Scenario has divergent recordings, so at least one variant must be reported. */
  expectVariants: boolean;
  /** Apps that must appear across the merged steps (case/accent-insensitive substring). */
  keyApps: string[];
  /** Each group is a set of synonyms; at least one synonym per group must appear in the step titles. */
  stepKeywords: string[][];
}

export interface OppExpect {
  /** When true, at least one wave-1 opportunity is required (quick wins while data is weak). */
  lowDataScore: boolean;
  /** Dimensions the enablement items may target. */
  weakDimensions: Gap[];
  /** Apps/handoff terms present in the recordings; expansion evidence must mention one. */
  recordingTerms: string[];
}

export interface RecordedSession {
  sessionId: string;
  analysis: Analysis;
}

/** Lowercase + strip accents so "Conciliação" matches "conciliacao". */
export function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const includesNorm = (haystack: string, needle: string): boolean => norm(haystack).includes(norm(needle));

export const CURRENCY_RE = /R\$|\bBRL\b|\breais\b/i;

const check = (name: string, pass: boolean, detail?: string): CheckResult => ({
  name,
  pass,
  ...(pass || !detail ? {} : { detail }),
});

/** Every string the agent wrote in a map submission. */
export function mapTexts(map: ProcessMapSubmission): string[] {
  return [
    ...map.steps.flatMap((s) => [s.title, ...s.apps, ...s.dataArtifacts, s.owner ?? ""]),
    ...map.variants.map((v) => v.description),
  ];
}

/** Every string the agent wrote in an opportunities submission. */
export function opportunityTexts(sub: OpportunitiesSubmission): string[] {
  return [
    ...sub.opportunities.flatMap((o) => [o.title, o.rationale, ...o.suggestedSquad.roles]),
    ...sub.enablement.flatMap((e) => [e.title, e.audience, e.rationale]),
    ...sub.expansion.flatMap((x) => [x.area, x.rationale, ...x.evidence, ...x.relatedApps]),
  ];
}

export function findCurrency(texts: string[]): string | undefined {
  return texts.find((t) => CURRENCY_RE.test(t));
}

/** Apps named in the recordings plus any extra handoff terms the scenario wants recognised. */
export function recordingTerms(sessions: RecordedSession[], extra: string[] = []): string[] {
  const apps = sessions.flatMap((s) => s.analysis.steps.flatMap((st) => st.apps));
  return [...new Set([...apps, ...extra].map((t) => t.trim()).filter(Boolean))];
}

export function checkMap(map: ProcessMapSubmission, sessions: RecordedSession[], expect: MapExpect): CheckResult[] {
  const out: CheckResult[] = [];
  const n = map.steps.length;
  out.push(
    check("map: step count in range", n >= expect.minSteps && n <= expect.maxSteps, `${n} steps, expected ${expect.minSteps}-${expect.maxSteps}`),
  );

  const real = new Map(sessions.map((s) => [s.sessionId, new Set(s.analysis.steps.map((st) => st.id))]));
  const noRefs = map.steps.filter((s) => s.sourceStepRefs.length === 0).map((s) => s.id);
  out.push(check("map: every step has sourceStepRefs", noRefs.length === 0, `without refs: ${noRefs.join(", ")}`));

  const bad: string[] = [];
  for (const s of map.steps) {
    for (const r of s.sourceStepRefs) {
      if (!real.get(r.sessionId)?.has(r.stepId)) bad.push(`${s.id}->${r.sessionId}/${r.stepId}`);
    }
  }
  out.push(check("map: sourceStepRefs resolve to real steps", bad.length === 0, `unresolved: ${bad.join(", ")}`));

  if (expect.expectVariants) {
    out.push(check("map: reports >=1 variant", map.variants.length >= 1, "no variants reported for divergent recordings"));
  }

  const stepIds = new Set(map.steps.map((s) => s.id));
  const orphan = map.variants.filter((v) => !stepIds.has(v.stepId)).map((v) => v.stepId);
  out.push(check("map: variants point at existing steps", orphan.length === 0, `unknown stepId: ${orphan.join(", ")}`));

  const appsText = map.steps.flatMap((s) => s.apps).join(" | ");
  const missingApps = expect.keyApps.filter((a) => !includesNorm(appsText, a));
  out.push(check("map: key apps present", missingApps.length === 0, `missing: ${missingApps.join(", ")}`));

  const titles = map.steps.map((s) => s.title).join(" | ");
  const missingKw = expect.stepKeywords.filter((group) => !group.some((k) => includesNorm(titles, k)));
  out.push(
    check("map: step titles cover required keywords", missingKw.length === 0, `uncovered: ${missingKw.map((g) => g.join("/")).join("; ")}`),
  );

  const cur = findCurrency(mapTexts(map));
  out.push(check("map: no currency in text", cur === undefined, `found: "${cur}"`));
  return out;
}

export function checkOpportunities(sub: OpportunitiesSubmission, expect: OppExpect): CheckResult[] {
  const out: CheckResult[] = [];
  const opps = sub.opportunities;
  const byId = new Map(opps.map((o) => [o.id, o]));

  const w3Bad = opps
    .filter((o) => o.wave === 3)
    .filter((o) => !o.prerequisites.some((p) => (byId.get(p)?.wave ?? 99) < 3))
    .map((o) => o.id);
  out.push(check("opps: wave-3 has a lower-wave prerequisite", w3Bad.length === 0, `offenders: ${w3Bad.join(", ")}`));

  if (expect.lowDataScore) {
    out.push(check("opps: wave-1 exists (data score low)", opps.some((o) => o.wave === 1), "no wave-1 opportunity"));
  }

  const cur = findCurrency(opportunityTexts(sub));
  out.push(check("opps: no currency in text", cur === undefined, `found: "${cur}"`));

  const full: Opportunity[] = opps.map((o, order) => ({ ...o, hidden: false, order }));
  const squad = validateSquadSize(full);
  out.push(check("opps: squad size within limits", squad.ok, squad.ok ? undefined : squad.error));

  const en = sub.enablement;
  out.push(check("enablement: 2-5 items", en.length >= 2 && en.length <= 5, `${en.length} items`));
  const badGap = en.filter((e) => !expect.weakDimensions.includes(e.gap)).map((e) => `${e.id}:${e.gap}`);
  out.push(
    check("enablement: gap matches a weak dimension", badGap.length === 0, `${badGap.join(", ")} not in [${expect.weakDimensions.join(", ")}]`),
  );

  const ex = sub.expansion;
  out.push(check("expansion: 0-5 fronts", ex.length <= 5, `${ex.length} fronts`));
  const badEv = ex
    .filter((x) => !x.evidence.some((ev) => expect.recordingTerms.some((t) => includesNorm(ev, t))))
    .map((x) => x.id);
  out.push(check("expansion: evidence mentions a recorded app/handoff", badEv.length === 0, `offenders: ${badEv.join(", ")}`));
  return out;
}

export const allPass = (checks: CheckResult[]): boolean => checks.every((c) => c.pass);
