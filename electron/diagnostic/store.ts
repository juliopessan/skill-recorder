import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { app } from "electron";
import { z } from "zod";

import { AnalysisSchema, type Analysis } from "../../common/analysis";
import {
  EngagementSchema,
  OpportunitySchema,
  ProcessMapSchema,
  type Engagement,
  type Opportunity,
  type ProcessMap,
} from "../../common/diagnostic";
import { isValidSessionId, sessionDir } from "../recorder/session-store";

/** Root folder that holds one sub-directory per diagnostic engagement. */
export function engagementsRoot(): string {
  const override = process.env.SKILL_RECORDER_ENGAGEMENTS_DIR;
  if (override) return path.resolve(override);
  return path.join(app.getPath("userData"), "engagements");
}

function assertId(id: unknown, what: string): asserts id is string {
  if (!isValidSessionId(id)) throw new Error(`Identificador inválido (${what}): ${String(id)}`);
}

function engagementDir(id: string): string {
  assertId(id, "diagnóstico");
  return path.join(engagementsRoot(), id);
}

function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}

/** Read + validate. Missing file → null; unparsable or schema-invalid → throws `corrupt()`. */
function readValidated<T>(file: string, schema: z.ZodType<T>, corrupt: () => Error): T | null {
  if (!existsSync(file)) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) throw corrupt();
    return parsed.data;
  } catch {
    throw corrupt();
  }
}

export function loadEngagement(id: string): Engagement | null {
  const dir = engagementDir(id);
  return readValidated(
    path.join(dir, "engagement.json"),
    EngagementSchema,
    () => new Error(`Diagnóstico corrompido: ${id}`),
  );
}

export function listEngagements(): Engagement[] {
  const root = engagementsRoot();
  if (!existsSync(root)) return [];
  const out: Engagement[] = [];
  for (const name of readdirSync(root)) {
    if (!isValidSessionId(name)) continue;
    try {
      if (!statSync(path.join(root, name)).isDirectory()) continue;
      const e = loadEngagement(name);
      if (e) out.push(e);
    } catch {
      // A corrupt engagement must not hide the others in the list.
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function saveEngagement(e: Engagement): void {
  const valid = EngagementSchema.parse(e);
  writeJsonAtomic(path.join(engagementDir(valid.id), "engagement.json"), valid);
}

export function deleteEngagement(id: string): void {
  rmSync(engagementDir(id), { recursive: true, force: true });
}

function mapFile(engagementId: string, processId: string): string {
  assertId(processId, "processo");
  return path.join(engagementDir(engagementId), "maps", `${processId}.json`);
}

export function loadProcessMap(engagementId: string, processId: string): ProcessMap | null {
  return readValidated(
    mapFile(engagementId, processId),
    ProcessMapSchema,
    () => new Error(`Mapa de processo corrompido: ${processId}`),
  );
}

export function saveProcessMap(engagementId: string, map: ProcessMap): void {
  const valid = ProcessMapSchema.parse(map);
  writeJsonAtomic(mapFile(engagementId, valid.processId), valid);
}

export function loadOpportunities(engagementId: string): Opportunity[] {
  return (
    readValidated(
      path.join(engagementDir(engagementId), "opportunities.json"),
      z.array(OpportunitySchema),
      () => new Error(`Oportunidades corrompidas: ${engagementId}`),
    ) ?? []
  );
}

export function saveOpportunities(engagementId: string, opps: Opportunity[]): void {
  const valid = z.array(OpportunitySchema).parse(opps);
  writeJsonAtomic(path.join(engagementDir(engagementId), "opportunities.json"), valid);
}

/**
 * Reads `<sessionDir>/analysis.json` directly (rather than importing the describer,
 * which pulls in the Copilot SDK). Null when the session dir or a valid analysis is missing.
 */
function readAnalysis(sessionId: string): Analysis | null {
  if (!isValidSessionId(sessionId)) return null;
  const file = path.join(sessionDir(sessionId), "analysis.json");
  try {
    const parsed = AnalysisSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Pure w.r.t. disk writes: returns a new Engagement with `stale` set where linked data vanished. */
export function refreshStale(e: Engagement): Engagement {
  return {
    ...e,
    processes: e.processes.map((p) => {
      const missing = p.sessionIds.some((sid) => readAnalysis(sid) === null);
      return missing && !p.stale ? { ...p, stale: true } : p;
    }),
  };
}

export function linkedAnalyses(
  e: Engagement,
  processId: string,
): { sessionId: string; analysis: Analysis }[] {
  const proc = e.processes.find((p) => p.id === processId);
  if (!proc) throw new Error(`Processo não encontrado: ${processId}`);
  const staleError = () =>
    new Error(`Processo desatualizado: ${proc.name}. Uma sessão vinculada foi removida ou perdeu a análise.`);
  if (proc.stale) throw staleError();
  return proc.sessionIds.map((sessionId) => {
    const analysis = readAnalysis(sessionId);
    if (!analysis) throw staleError();
    return { sessionId, analysis };
  });
}
