import { approveAll, CopilotClient, type CopilotSession, type Tool } from "@github/copilot-sdk";

import { COPILOT_SIGNED_OUT_ERROR } from "../../common/ipc";
import type { Opportunity, ProcessMap, ProcessMapSubmission, OpportunitiesSubmission } from "../../common/diagnostic";
import { copilotConnectionOption, withStartupTimeout } from "../copilot-cli-path";
import { createLogger } from "../logger";
import { MAP_INSTRUCTIONS, OPPORTUNITY_INSTRUCTIONS } from "./instructions";
import {
  linkedAnalyses,
  loadEngagement,
  loadProcessMap,
  refreshStale,
  saveInitiatives,
  saveOpportunities,
  saveProcessMap,
} from "./store";
import { buildMapTools, buildOpportunityTools } from "./tools";

const log = createLogger("DiagnosticAgent");

/** How long a single agent turn may run before we give up. */
const TURN_TIMEOUT_MS = 180_000;

const NUDGE_MAP = "Chame submit_process_map agora com o seu melhor mapa de processo.";
const NUDGE_OPPS = "Chame submit_opportunities agora com a sua melhor lista de oportunidades.";

const CANCELLED_MESSAGE = "Geração cancelada.";

/** A result may be saved only when a validated submission was captured and no cancel arrived. */
export function shouldPersist(state: { submitted: boolean; cancelled: boolean }): boolean {
  return state.submitted && !state.cancelled;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Drives short-lived Copilot agent turns that produce the process map and the opportunity list.
 * Each call uses a fresh session restricted to this module's tools. Nothing is persisted unless a
 * validated submission was captured, so failure/timeout/cancel leave saved data untouched.
 */
export class DiagnosticAgent {
  private client: CopilotClient | null = null;
  private clientStart: Promise<CopilotClient> | null = null;
  private model: string | undefined;
  private current: CopilotSession | null = null;
  private running = false;
  private cancelled = false;

  async generateMap(
    engagementId: string,
    processId: string,
    feedback?: string,
    onProgress?: (message: string) => void,
  ): Promise<ProcessMap> {
    return this.exclusive(async () => {
      const raw = loadEngagement(engagementId);
      if (!raw) throw new Error(`Diagnóstico não encontrado: ${engagementId}`);
      const analyses = linkedAnalyses(refreshStale(raw), processId);
      if (analyses.length === 0) throw new Error("O processo não tem gravações vinculadas.");
      const prior = loadProcessMap(engagementId, processId);

      let submission: ProcessMapSubmission | undefined;
      const tools = buildMapTools({ analyses, onSubmit: (s) => { submission = s; } });
      const prompt =
        "Consolide as análises vinculadas em um mapa de processo. Comece por get_analyses e, ao final, chame submit_process_map." +
        (prior ? `\n\nMapa atual (revise-o):\n${JSON.stringify(prior.steps.map((s) => ({ id: s.id, title: s.title })))}` : "") +
        (feedback?.trim() ? `\n\nFeedback do usuário:\n${feedback.trim()}` : "");
      await this.runTurn(MAP_INSTRUCTIONS, tools, prompt, NUDGE_MAP, () => submission !== undefined, onProgress);
      this.throwIfCancelled();
      if (!submission || !shouldPersist({ submitted: true, cancelled: this.cancelled })) throw new Error("O agente terminou sem enviar um mapa de processo.");

      const map: ProcessMap = {
        ...submission,
        version: 1,
        processId,
        revision: (prior?.revision ?? 0) + 1,
        createdAt: Date.now(),
      };
      saveProcessMap(engagementId, map);
      onProgress?.("Mapa pronto.");
      return map;
    });
  }

  async generateOpportunities(
    engagementId: string,
    feedback?: string,
    onProgress?: (message: string) => void,
  ): Promise<Opportunity[]> {
    return this.exclusive(async () => {
      const engagement = loadEngagement(engagementId);
      if (!engagement) throw new Error(`Diagnóstico não encontrado: ${engagementId}`);
      const maps: Record<string, ProcessMap> = {};
      for (const p of engagement.processes) {
        const m = loadProcessMap(engagementId, p.id);
        if (m) maps[p.id] = m;
      }
      if (Object.keys(maps).length === 0) throw new Error("Gere ao menos um mapa de processo antes das oportunidades.");

      let submission: OpportunitiesSubmission | undefined;
      const tools = buildOpportunityTools({ engagement, maps, onSubmit: (s) => { submission = s; } });
      const prompt =
        "Proponha as oportunidades do diagnóstico. Comece por get_diagnostic_context e, ao final, chame submit_opportunities." +
        (feedback?.trim() ? `\n\nFeedback do usuário:\n${feedback.trim()}` : "");
      await this.runTurn(OPPORTUNITY_INSTRUCTIONS, tools, prompt, NUDGE_OPPS, () => submission !== undefined, onProgress);
      this.throwIfCancelled();
      if (!submission || !shouldPersist({ submitted: true, cancelled: this.cancelled })) throw new Error("O agente terminou sem enviar oportunidades.");

      const opps: Opportunity[] = submission.opportunities.map((o, order) => ({ ...o, hidden: false, order }));
      saveOpportunities(engagementId, opps);
      saveInitiatives(engagementId, {
        enablement: submission.enablement.map((x, order) => ({ ...x, hidden: false, order })),
        expansion: submission.expansion.map((x, order) => ({ ...x, hidden: false, order })),
      });
      onProgress?.("Oportunidades prontas.");
      return opps;
    });
  }

  /** Abort an in-flight turn. */
  cancel(): void {
    this.cancelled = true;
    const s = this.current;
    if (s) void s.abort().catch(() => undefined);
  }

  /** Tear down the client (call on app quit). */
  async dispose(): Promise<void> {
    this.cancel();
    if (this.client) await this.client.stop().catch(() => undefined);
    this.client = null;
    this.clientStart = null;
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running) throw new Error("Já existe uma geração em andamento.");
    this.running = true;
    this.cancelled = false;
    try {
      return await fn();
    } finally {
      this.running = false;
    }
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new Error(CANCELLED_MESSAGE);
  }

  /** Protected so tests can substitute a fake turn without a live Copilot. */
  protected async runTurn(
    instructions: string,
    tools: Tool[],
    prompt: string,
    nudge: string,
    submitted: () => boolean,
    onProgress?: (message: string) => void,
  ): Promise<void> {
    onProgress?.("Iniciando…");
    const client = await this.ensureClient();
    this.throwIfCancelled();
    const session = await client.createSession({
      systemMessage: { mode: "append" as const, content: instructions },
      tools,
      onPermissionRequest: approveAll,
      workingDirectory: process.cwd(),
      enableHostGitOperations: false,
      infiniteSessions: { enabled: false },
      ...(this.model ? { model: this.model } : {}),
      // Restrict the agent to this module's own tools (no default toolset under approveAll).
      availableTools: tools.map((t) => t.name),
    });
    this.current = session;
    try {
      this.throwIfCancelled();
      onProgress?.("Analisando…");
      try {
        await session.sendAndWait(prompt, TURN_TIMEOUT_MS);
      } catch (err) {
        await session.abort().catch(() => undefined);
        this.throwIfCancelled();
        throw new Error(`Falha na geração: ${msg(err)}`);
      }
      this.throwIfCancelled();
      if (!submitted()) {
        onProgress?.("Pedindo ao agente que finalize…");
        await session.sendAndWait(nudge, TURN_TIMEOUT_MS).catch(() => undefined);
        this.throwIfCancelled();
      }
    } finally {
      this.current = null;
      await session.disconnect().catch(() => undefined);
    }
  }

  private async ensureClient(): Promise<CopilotClient> {
    if (this.client) return this.client;
    if (this.clientStart) return this.clientStart;
    this.clientStart = (async () => {
      const client = new CopilotClient(copilotConnectionOption());
      await withStartupTimeout(client.start(), "Copilot CLI (Diagnostic)");
      const auth = await client.getAuthStatus();
      if (!auth.isAuthenticated) {
        await client.stop().catch(() => undefined);
        throw new Error(COPILOT_SIGNED_OUT_ERROR);
      }
      const override = process.env.SKILL_RECORDER_MODEL;
      this.model = override || undefined;
      log.info("Copilot ready", auth.login ? `as ${auth.login}` : "");
      this.client = client;
      return client;
    })();
    try {
      return await this.clientStart;
    } catch (err) {
      this.clientStart = null;
      throw err;
    }
  }
}
