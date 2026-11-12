import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { Engagement, Initiatives, Opportunity } from "../common/diagnostic";
import { DEFAULT_THESIS_TEXT } from "../common/diagnostic-config";
import type { DiagnosticBundle, SessionSummary } from "../common/ipc";
import {
  createUpdateQueue,
  mergeSuggestedQuestionnaire,
  newId,
  nextStep,
  type DiagnosticStep,
  type UpdateQueue,
} from "./diagnostic-view-state";
import { EngagementList } from "./diagnostics/EngagementList";
import { EngagementSetup } from "./diagnostics/EngagementSetup";
import { InitiativesPanel } from "./diagnostics/InitiativesPanel";
import { OpportunityList } from "./diagnostics/OpportunityList";
import { ProcessesSection } from "./diagnostics/ProcessPanel";
import { QuestionnaireForm } from "./diagnostics/QuestionnaireForm";
import { ReportPanel } from "./diagnostics/ReportPanel";
import { isError, safeCall, type GenerationState } from "./diagnostics/shared";

const STEP_LABEL: Record<DiagnosticStep, string> = {
  roles: "Defina os papéis e seus custos por hora.",
  processes: "Adicione os processos do cliente e vincule gravações analisadas.",
  questionnaire: "Responda e confirme o questionário de prontidão dos dados.",
  maps: "Gere o mapa de cada processo.",
  baseline: "Confirme volume, pessoas e papel de cada processo.",
  opportunities: "Gere as oportunidades.",
  report: "Revise o relatório e exporte.",
};

const IDLE: GenerationState = { running: null, progress: null, failure: null };

interface Queues {
  id: string;
  engagement: UpdateQueue<Engagement>;
  opportunities: UpdateQueue<Opportunity[]>;
  initiatives: UpdateQueue<Initiatives>;
}

export function Diagnostics({ renderSwitcher }: { renderSwitcher: (busy: boolean) => ReactNode }) {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<DiagnosticBundle | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [generation, setGeneration] = useState<GenerationState>(IDLE);
  const [exporting, setExporting] = useState<"html" | "pdf" | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const loadToken = useRef(0);
  const alive = useRef(true);
  const runningRef = useRef(false);
  const queues = useRef<Queues | null>(null);
  const busy = generation.running !== null;

  const fail = useCallback((message: string) => {
    if (alive.current) setNotice(message);
  }, []);

  const loadList = useCallback(async () => {
    const res = await safeCall(() => window.skillRecorder.listDiagnostics());
    if (!alive.current) return;
    if (isError(res)) fail(res.error);
    else setEngagements(res);
    setLoaded(true);
  }, [fail]);

  const loadBundle = useCallback(
    async (id: string) => {
      const token = ++loadToken.current;
      const res = await safeCall(() => window.skillRecorder.getDiagnostic(id));
      if (token !== loadToken.current || !alive.current) return;
      if (isError(res)) {
        setBundle(null);
        fail(res.error);
        return;
      }
      if (queues.current?.id === id) {
        queues.current.engagement.sync(res.engagement);
        queues.current.opportunities.sync(res.opportunities);
        queues.current.initiatives.sync(res.initiatives);
      } else {
        queues.current = {
          id,
          engagement: createUpdateQueue(res.engagement, async (value) => {
            const saved = await safeCall(() => window.skillRecorder.saveDiagnostic(value));
            return isError(saved) ? saved.error : null;
          }),
          opportunities: createUpdateQueue(res.opportunities, async (value) => {
            const saved = await safeCall(() => window.skillRecorder.saveDiagnosticOpportunities(id, value));
            return isError(saved) ? saved.error : null;
          }),
          initiatives: createUpdateQueue(res.initiatives, async (value) => {
            const saved = await safeCall(() => window.skillRecorder.saveDiagnosticInitiatives(id, value));
            return isError(saved) ? saved.error : null;
          }),
        };
      }
      setBundle(res);
    },
    [fail],
  );

  const loadSessions = useCallback(async () => {
    try {
      const list = await window.skillRecorder.listSessions();
      if (alive.current) setSessions(list);
    } catch (error) {
      console.error("Could not list sessions for diagnostics:", error);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void loadList();
    void loadSessions();
    const offSessions = window.skillRecorder.onSessionsChanged(() => { void loadSessions(); });
    const offProgress = window.skillRecorder.onDiagnosticProgress((message) => {
      if (alive.current) setGeneration((g) => (g.running ? { ...g, progress: message } : g));
    });
    return () => {
      alive.current = false;
      offSessions();
      offProgress();
      // Leaving the view must not leave a main-process job running with nobody to receive it.
      if (runningRef.current) void Promise.resolve(window.skillRecorder.cancelDiagnostic()).catch(() => undefined);
    };
  }, [loadList, loadSessions]);

  const cancel = useCallback(() => {
    void Promise.resolve(window.skillRecorder.cancelDiagnostic()).catch(() => fail("Não foi possível cancelar a geração."));
  }, [fail]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setBundle(null);
      setExportNotice(null);
      setGeneration(IDLE);
      queues.current = null;
      if (id) void loadBundle(id);
      else loadToken.current++;
    },
    [loadBundle],
  );

  /** After a queued save: surface the error, then refresh so scores and totals stay consistent. */
  const afterSave = useCallback(
    async (id: string, error: string | null): Promise<string | null> => {
      if (!alive.current) return error;
      if (error) fail(error);
      if (queues.current?.id === id) await Promise.all([loadBundle(id), loadList()]);
      return error;
    },
    [fail, loadBundle, loadList],
  );

  /** Every edit is an updater applied to the newest value, so a click never overwrites a blur-commit. */
  const persist = useCallback(
    async (update: (prev: Engagement) => Engagement): Promise<string | null> => {
      const q = queues.current;
      if (!q) return null;
      return afterSave(q.id, await q.engagement.enqueue(update));
    },
    [afterSave],
  );

  const saveOpportunities = useCallback(
    async (update: (prev: Opportunity[]) => Opportunity[]): Promise<string | null> => {
      const q = queues.current;
      if (!q) return null;
      return afterSave(q.id, await q.opportunities.enqueue(update));
    },
    [afterSave],
  );

  const saveInitiatives = useCallback(
    async (update: (prev: Initiatives) => Initiatives): Promise<string | null> => {
      const q = queues.current;
      if (!q) return null;
      return afterSave(q.id, await q.initiatives.enqueue(update));
    },
    [afterSave],
  );

  const create = async (clientName: string) => {
    const engagement: Engagement = {
      version: 1,
      id: newId("eng"),
      clientName,
      createdAt: Date.now(),
      currency: "BRL",
      roles: [],
      dataQuestionnaire: {},
      processes: [],
      thesisText: DEFAULT_THESIS_TEXT,
    };
    const res = await safeCall(() => window.skillRecorder.saveDiagnostic(engagement));
    if (isError(res)) return fail(res.error);
    await loadList();
    if (alive.current) select(res.id);
  };

  const remove = async (id: string) => {
    const res = await safeCall(() => window.skillRecorder.deleteDiagnostic(id));
    if (isError(res)) return fail(res.error);
    if (alive.current && id === selectedId) select(null);
    await loadList();
  };

  const suggest = async () => {
    if (!bundle) return;
    const res = await safeCall(() => window.skillRecorder.suggestDiagnosticQuestionnaire(bundle.engagement.id));
    if (isError(res)) return fail(res.error);
    if (Object.keys(res).length === 0) {
      return fail("Ainda não há passos mapeados para sugerir respostas. Gere ao menos um mapa de processo.");
    }
    const error = await persist((e) => ({ ...e, dataQuestionnaire: mergeSuggestedQuestionnaire(e.dataQuestionnaire, res) }));
    if (error === null && alive.current) {
      setNotice("Respostas sugeridas a partir das gravações. Revise e confirme cada eixo; Inventário e Governança dependem do cliente.");
    }
  };

  /** Runs one generation; whatever happens, `running` is cleared so the view never stays locked. */
  const runGeneration = async (
    running: NonNullable<GenerationState["running"]>,
    scope: string,
    call: (engagementId: string) => Promise<unknown>,
    retry: () => void,
  ): Promise<void> => {
    if (!bundle || runningRef.current) return;
    const id = bundle.engagement.id;
    runningRef.current = true;
    setNotice(null);
    setGeneration({ running, progress: null, failure: null });
    let failure: GenerationState["failure"] = null;
    try {
      // Let any pending edit reach the store before the agent reads it, and drain the opportunity and
      // initiative queues so loadBundle below can re-sync them (a queue with saves in flight ignores sync).
      const q = queues.current;
      if (q) {
        await Promise.all([
          q.engagement.enqueue((prev) => prev),
          q.opportunities.enqueue((prev) => prev),
          q.initiatives.enqueue((prev) => prev),
        ]);
      }
      const res = await safeCall(() => call(id) as Promise<{ error: string } | unknown>);
      if (isError(res)) failure = { scope, message: res.error, retry };
      if (alive.current) await loadBundle(id);
    } finally {
      runningRef.current = false;
      if (alive.current) setGeneration({ running: null, progress: null, failure });
    }
  };

  const generateMap = (processId: string, feedback: string): Promise<void> =>
    runGeneration(
      { kind: "map", processId },
      processId,
      (id) => window.skillRecorder.generateDiagnosticMap(id, processId, feedback || undefined),
      () => void generateMap(processId, feedback),
    );

  const generateOpportunities = (feedback: string): Promise<void> =>
    runGeneration(
      { kind: "opportunities" },
      "opportunities",
      (id) => window.skillRecorder.generateDiagnosticOpportunities(id, feedback || undefined),
      () => void generateOpportunities(feedback),
    );

  const exportReport = async (format: "html" | "pdf") => {
    if (!bundle) return;
    setExporting(format);
    setExportNotice(null);
    const res = await safeCall(() => window.skillRecorder.exportDiagnostic(bundle.engagement.id, format));
    if (!alive.current) return;
    setExporting(null);
    if (isError(res)) fail(res.error);
    else if ("path" in res) setExportNotice(`Relatório salvo em ${res.path}`);
  };

  const e = bundle?.engagement;
  const step = bundle ? nextStep(bundle.engagement, bundle.maps, bundle.opportunities) : null;
  const hasMaps = bundle ? Object.keys(bundle.maps).length > 0 : false;

  return (
    <div className="lib">
      <aside className="lib-list">
        <div className="lib-list-head diag-head">{renderSwitcher(busy)}</div>
        {notice && (
          <button type="button" className="sess-notice" onClick={() => setNotice(null)} title="Dispensar">
            {notice}
          </button>
        )}
        <EngagementList
          engagements={engagements}
          loaded={loaded}
          selectedId={selectedId}
          disabled={busy}
          onSelect={select}
          onCreate={create}
          onDelete={remove}
        />
      </aside>
      <main className="lib-detail diag-main">
        {bundle && e && step ? (
          <div className="diag-scroll">
            <header className="diag-title">
              <span className="eyebrow">Diagnóstico de prontidão para IA</span>
              <h1 className="diag-h1">{e.clientName}</h1>
              <p className="diag-maturity">
                <strong>Maturidade em IA: Nível {bundle.report.maturity.level} de 5 — {bundle.report.maturity.name}</strong>
                {bundle.report.maturity.nextLevel
                  ? ` · faltam ${bundle.report.maturity.nextLevel.pointsNeeded} pontos para o nível ${bundle.report.maturity.nextLevel.level}; dimensão mais fraca: ${bundle.report.maturity.weakest}`
                  : " · nível máximo"}
              </p>
              <p className="diag-next"><strong>Próximo passo:</strong> {STEP_LABEL[step]}</p>
            </header>
            <EngagementSetup engagement={e} disabled={busy} onChange={(u) => void persist(u)} />
            <ProcessesSection
              engagement={e}
              report={bundle.report.processes}
              maps={bundle.maps}
              sessions={sessions}
              generation={generation}
              disabled={busy}
              onChange={(u) => void persist(u)}
              onGenerate={(pid, fb) => void generateMap(pid, fb)}
              onCancel={cancel}
            />
            <QuestionnaireForm
              questionnaire={e.dataQuestionnaire}
              disabled={busy}
              hasMaps={hasMaps}
              onChange={(u) => void persist((prev) => ({ ...prev, dataQuestionnaire: u(prev.dataQuestionnaire) }))}
              onSuggest={suggest}
            />
            <OpportunityList
              opportunities={bundle.opportunities}
              report={bundle.report.opportunities}
              currency={e.currency}
              processNames={Object.fromEntries(e.processes.map((p) => [p.id, p.name]))}
              hasMaps={hasMaps}
              generation={generation}
              disabled={busy}
              maps={bundle.maps}
              savingsAreEstimates={bundle.report.savingsAreEstimates}
              onSave={(u) => void saveOpportunities(u)}
              onGenerate={(fb) => void generateOpportunities(fb)}
              onCancel={cancel}
            />
            <InitiativesPanel
              initiatives={bundle.initiatives}
              disabled={busy}
              onSave={(u) => void saveInitiatives(u)}
            />
            <ReportPanel
              report={bundle.report}
              currency={e.currency}
              disabled={busy}
              exporting={exporting}
              exportNotice={exportNotice}
              onExport={(f) => void exportReport(f)}
            />
          </div>
        ) : (
          <div className="detail-empty">
            <span className="eyebrow">{selectedId ? "Carregando" : "Nenhum diagnóstico selecionado"}</span>
            <p>
              {selectedId
                ? "Abrindo o diagnóstico…"
                : "Crie um diagnóstico para o cliente ou escolha um à esquerda para continuar de onde parou."}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
