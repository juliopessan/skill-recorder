import type { Engagement } from "../../common/diagnostic";
import type { DiagnosticResult } from "../../common/ipc";
import { createLogger } from "../logger";
import { refreshStale } from "./store";

const log = createLogger("DiagnosticIpc");

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Runs `fn`, converting any throw into `{ error }` so nothing rejects into the renderer. */
export async function safely<T>(fn: () => T | Promise<T>): Promise<DiagnosticResult<T>> {
  try {
    return await fn();
  } catch (err) {
    log.warn("Diagnostic handler failed:", errMessage(err));
    return { error: errMessage(err) };
  }
}

/**
 * Recomputes staleness from scratch: every process is cleared, then `refreshStale` re-flags
 * those whose linked sessions vanished. Relinking a session therefore heals a process.
 * `changed` tells the caller whether the result differs from what was stored.
 */
export function recomputeStale(
  e: Engagement,
  refresh: (e: Engagement) => Engagement = refreshStale,
): { engagement: Engagement; changed: boolean } {
  const cleared: Engagement = { ...e, processes: e.processes.map((p) => ({ ...p, stale: false })) };
  const engagement = refresh(cleared);
  const changed = engagement.processes.some((p, i) => p.stale !== e.processes[i]?.stale);
  return { engagement, changed };
}

/** `diagnostico-<client slug>.<ext>`; accents are stripped, an empty slug falls back to "cliente". */
export function exportFileName(clientName: string, format: "html" | "pdf"): string {
  const slug =
    clientName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "cliente";
  return `diagnostico-${slug}.${format}`;
}
