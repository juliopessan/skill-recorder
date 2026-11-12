import os from "node:os";
import path from "node:path";

import { BrowserWindow, dialog, ipcMain } from "electron";
import { z } from "zod";

import {
  EngagementSchema,
  InitiativesSchema,
  OpportunitySchema,
  type Engagement,
  type Opportunity,
  type ProcessMap,
} from "../../common/diagnostic";
import { buildReportModel, renderReportHtml } from "../../common/diagnostic-report";
import { suggestQuestionnaire, validateOpportunities } from "../../common/diagnostic-rules";
import { IPC } from "../../common/ipc";
import type { DiagnosticAgent } from "./agent";
import { exportFileName, recomputeStale, safely } from "./ipc-helpers";
import { exportReport } from "./export";
import {
  deleteEngagement,
  listEngagements,
  loadEngagement,
  loadInitiatives,
  loadOpportunities,
  loadProcessMap,
  refreshStale,
  saveEngagement,
  saveInitiatives,
  saveOpportunities,
} from "./store";

function requireEngagement(id: string): Engagement {
  const e = loadEngagement(id);
  if (!e) throw new Error(`Diagnóstico não encontrado: ${id}`);
  return e;
}

function loadMaps(e: Engagement): Record<string, ProcessMap> {
  const maps: Record<string, ProcessMap> = {};
  for (const p of e.processes) {
    const m = loadProcessMap(e.id, p.id);
    if (m) maps[p.id] = m;
  }
  return maps;
}

const FormatSchema = z.enum(["html", "pdf"]);

export function registerDiagnosticIpc(
  agent: DiagnosticAgent,
  onProgress: (message: string) => void = () => undefined,
): void {
  ipcMain.handle(IPC.diagnosticList, () => safely(() => listEngagements()));

  ipcMain.handle(IPC.diagnosticGet, (_e, id: string) =>
    safely(() => {
      const stored = requireEngagement(id);
      const { engagement, changed } = recomputeStale(stored);
      if (changed) saveEngagement(engagement);
      const maps = loadMaps(engagement);
      const opportunities = loadOpportunities(engagement.id);
      const initiatives = loadInitiatives(engagement.id);
      const report = buildReportModel(engagement, maps, opportunities, Date.now(), initiatives);
      return { engagement, maps, opportunities, initiatives, report };
    }),
  );

  ipcMain.handle(IPC.diagnosticSave, (_e, payload: unknown) =>
    safely(() => {
      const engagement = EngagementSchema.parse(payload);
      saveEngagement(engagement);
      return engagement;
    }),
  );

  ipcMain.handle(IPC.diagnosticSaveOpportunities, (_e, engagementId: string, payload: unknown) =>
    safely(() => {
      requireEngagement(engagementId);
      const opps: Opportunity[] = z.array(OpportunitySchema).parse(payload);
      const check = validateOpportunities(opps);
      if (!check.ok) throw new Error(check.error);
      saveOpportunities(engagementId, opps);
      return opps;
    }),
  );

  ipcMain.handle(IPC.diagnosticSaveInitiatives, (_e, engagementId: string, payload: unknown) =>
    safely(() => {
      requireEngagement(engagementId);
      const initiatives = InitiativesSchema.parse(payload);
      saveInitiatives(engagementId, initiatives);
      return initiatives;
    }),
  );

  ipcMain.handle(IPC.diagnosticDelete, (_e, id: string) =>
    safely(() => {
      deleteEngagement(id);
      return { ok: true as const };
    }),
  );

  ipcMain.handle(IPC.diagnosticSuggestQuestionnaire, (_e, id: string) =>
    safely(() => suggestQuestionnaire(Object.values(loadMaps(requireEngagement(id))))),
  );

  ipcMain.handle(
    IPC.diagnosticGenerateMap,
    (_e, engagementId: string, processId: string, feedback?: string) =>
      safely(() =>
        agent.generateMap(
          engagementId,
          processId,
          typeof feedback === "string" ? feedback : undefined,
          onProgress,
        ),
      ),
  );

  ipcMain.handle(IPC.diagnosticGenerateOpportunities, (_e, engagementId: string, feedback?: string) =>
    safely(() =>
      agent.generateOpportunities(engagementId, typeof feedback === "string" ? feedback : undefined, onProgress),
    ),
  );

  ipcMain.handle(IPC.diagnosticCancel, () => {
    agent.cancel();
    return { ok: true as const };
  });

  ipcMain.handle(IPC.diagnosticExport, (event, engagementId: string, rawFormat: unknown) =>
    safely(async () => {
      const format = FormatSchema.parse(rawFormat);
      const engagement = refreshStale(requireEngagement(engagementId));
      const maps = loadMaps(engagement);
      const model = buildReportModel(engagement, maps, loadOpportunities(engagementId), Date.now(), loadInitiatives(engagementId));
      const html = renderReportHtml(model, engagement, maps);
      const opts = {
        title: "Exportar diagnóstico",
        defaultPath: path.join(os.homedir(), "Downloads", exportFileName(engagement.clientName, format)),
        filters:
          format === "pdf"
            ? [{ name: "PDF", extensions: ["pdf"] }]
            : [{ name: "HTML", extensions: ["html"] }],
      };
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) return { canceled: true as const };
      await exportReport(html, result.filePath, format);
      return { path: result.filePath };
    }),
  );
}
