// Squad role helpers shared by the rules (validation, draft reasons) and the math (squad cost).
// Kept free of imports from either module so neither depends on the other for these.
import type { Opportunity } from "./diagnostic";

/** Case-insensitive, trimmed identity of a squad role name. */
export const roleKey = (r: string): string => r.trim().toLowerCase();

/** Adds the non-blank roles of `roles` to `into`, keyed by `roleKey`, keeping the first spelling. */
export function distinctRoles(roles: string[], into: Map<string, string> = new Map()): Map<string, string> {
  for (const raw of roles) {
    const name = raw.trim();
    if (name && !into.has(roleKey(name))) into.set(roleKey(name), name);
  }
  return into;
}

/** One rate per role (case-insensitive, trimmed): the first entry wins, later duplicates are dropped. */
export function dedupeSquadRates<T extends { role: string }>(rates: T[]): T[] {
  const seen = new Set<string>();
  return rates.filter((r) => {
    const k = roleKey(r.role);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Distinct roles (case-insensitive, trimmed, first spelling kept) per wave among visible opportunities. */
export function squadByWave(opps: Opportunity[]): { wave: 1 | 2 | 3; roles: string[] }[] {
  return ([1, 2, 3] as const).map((wave) => {
    const m = new Map<string, string>();
    for (const o of opps) if (!o.hidden && o.wave === wave) distinctRoles(o.suggestedSquad.roles, m);
    return { wave, roles: [...m.values()] };
  });
}
