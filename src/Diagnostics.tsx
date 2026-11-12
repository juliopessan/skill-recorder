import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { DataQuestionnaire, Engagement, Opportunity } from "../common/diagnostic";
import { DEFAULT_THESIS_TEXT } from "../common/diagnostic-config";
import type { DiagnosticBundle, SessionSummary } from "../common/ipc";
import { mergeSuggestedQuestionnaire, nextStep, newId, type DiagnosticStep } from "./diagnostic-view-state";
import { EngagementList } from "./diagnostics/EngagementList";
import { EngagementSetup } from "./diagnostics/EngagementSetup";
import { OpportunityList } from "./diagnostics/OpportunityList";
import { ProcessesSection, type GenerationState } from "./diagnostics/ProcessPanel";
import { QuestionnaireForm } from "./diagnostics/QuestionnaireForm";
import { ReportPanel } from "./diagnostics/ReportPanel";
import { isError } from "./diagnostics/shared";

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

export function Diagnostics({ switcher }: { switcher: ReactNode }) {
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
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const busy = generation.running !== null;

  const fail = useCallback((message: string) => setNotice(message), []);

  const loadList = useCallback(async () => {
    const res = await window.skillRecorder.listDiagnostics();
    if (isError(res)) fail(res.error);
    else setEngagements(res);
    setLoaded(true);
  }, [fail]);

  const loadBundle = useCallback(
    async (id: string) => {
      const token = ++loadToken.current;
      const res = await window.skillRecorder.getDiagnostic(id);
      if (token !== loadToken.current) return;
      if (isError(res)) {
        setBundle(null);
        fail(res.error);
      } else setBundle(res);
    },
    [fail],
  );

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await window.skillRecorder.listSessions());
    } catch (error) {
      console.error("Could not list sessions for diagnostics:", error);
    }
  }, []);

  useEffect(() => {
    void loadList();
    void loadSessions();
    const offSessions = window.skillRecorder.onSessionsChanged(() => { void loadSessions(); });
    const offProgress = window.skillRecorder.onDiagnosticProgress((message) => {
      setGeneration((g) => (g.running ? { ...g, progress: message } : g));
    });
    return () => { offSessions(); offProgress(); };
  }, [loadList, loadSessions]);

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      setBundle(null);
      setExportNotice(null);
      setGeneration(IDLE);
      if (id) void loadBundle(id);
      else loadToken.current++;
    },
    [loadBundle],
  );

  /** Saves serialise through a queue so quick successive edits cannot overwrite each other. */
  const persist = useCallback(
    (next: Engagement): Promise<void> => {
      const run = async () => {
        const res = await window.skillRecorder.saveDiagnostic(next);
        if (isError(res)) fail(res.error);
        await Promise.all([loadBundle(next.id), loadList()]);
      };
      const queued = saveQueue.current.then(run, run);
      saveQueue.current = queued;
      return queued;
    },
    [fail, loadBundle, loadList],
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
    const res = await window.skillRecorder.saveDiagnostic(engagement);
    if (isError(res)) return fail(res.error);
    await loadList();
    select(res.id);
  };

  const remove = async (id: string) => {
    const res = await window.skillRecorder.deleteDiagnostic(id);
    if (isError(res)) return fail(res.error);
    if (id === selectedId) select(null);
    await loadList();
  };

  const saveOpportunities = async (next: Opportunity[]) => {
    if (!bundle) return;
    const res = await window.skillRecorder.saveDiagnosticOpportunities(bundle.engagement.id, next);
    if (isError(res)) fail(res.error);
    await loadBundle(bundle.engagement.id);
  };

  const suggest = async () => {
    if (!bundle) return;
    const res = await window.skillRecorder.suggestDiagnosticQuestionnaire(bundle.engagement.id);
    if (isError(res)) return fail(res.error);
    if (Object.keys(res).length === 0) {
      return fail("Ainda não há passos mapeados para sugerir respostas. Gere ao menos um mapa de processo.");
    }
    const merged: DataQuestionnaire = mergeSuggestedQuestionnaire(bundle.engagement.dataQuestionnaire, res);
    await persist({ ...bundle.engagement, dataQuestionnaire: merged });
    setNotice("Respostas sugeridas a partir das gravações. Revise e confirme cada eixo; Inventário e Governança dependem do cliente.");
  };

  const generateMap = async (processId: string, feedback: string): Promise<void> => {
    if (!bundle || busy) return;
    const id = bundle.engagement.id;
    setNotice(null);
    setGeneration({ running: { kind: "map", processId }, progress: null, failure: null });
    const res = await window.skillRecorder.generateDiagnosticMap(id, processId, feedback || undefined);
    await loadBundle(id);
    setGeneration(
      isError(res)
        ? { running: null, progress: null, failure: { scope: processId, message: res.error, retry: () => void generateMap(processId, feedback) } }
        : IDLE,
    );
  };

  const generateOpportunities = async (feedback: string): Promise<void> => {
    if (!bundle || busy) return;
    const id = bundle.engagement.id;
    setNotice(null);
    setGeneration({ running: { kind: "opportunities" }, progress: null, failure: null });
    const res = await window.skillRecorder.generateDiagnosticOpportunities(id, feedback || undefined);
    await loadBundle(id);
    setGeneration(
      isError(res)
        ? { running: null, progress: null, failure: { scope: "opportunities", message: res.error, retry: () => void generateOpportunities(feedback) } }
        : IDLE,
    );
  };

  const exportReport = async (format: "html" | "pdf") => {
    if (!bundle) return;
    setExporting(format);
    setExportNotice(null);
    const res = await window.skillRecorder.exportDiagnostic(bundle.engagement.id, format);
    setExporting(null);
    if (isError(res)) fail(res.error);
    else if ("path" in res) setExportNotice(`Relatório salvo em ${res.path}`);
  };

  const e = bundle?.engagement;
  const step = bundle ? nextStep(bundle.engagement, bundle.maps, bundle.opportunities) : null;

  return (
    <div className="lib">
      <aside className="lib-list">
        <div className="lib-list-head diag-head">{switcher}</div>
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
              <p className="diag-next"><strong>Próximo passo:</strong> {STEP_LABEL[step]}</p>
            </header>
            <EngagementSetup engagement={e} disabled={busy} onChange={persist} />
            <ProcessesSection
              engagement={e}
              report={bundle.report.processes}
              maps={bundle.maps}
              sessions={sessions}
              generation={generation}
              disabled={busy}
              onChange={persist}
              onGenerate={(pid, fb) => void generateMap(pid, fb)}
              onCancel={() => void window.skillRecorder.cancelDiagnostic()}
            />
            <QuestionnaireForm
              questionnaire={e.dataQuestionnaire}
              disabled={busy}
              hasMaps={Object.keys(bundle.maps).length > 0}
              onChange={(q) => persist({ ...e, dataQuestionnaire: q })}
              onSuggest={suggest}
            />
            <OpportunityList
              opportunities={bundle.opportunities}
              report={bundle.report.opportunities}
              currency={e.currency}
              processNames={Object.fromEntries(e.processes.map((p) => [p.id, p.name]))}
              hasMaps={Object.keys(bundle.maps).length > 0}
              generation={generation}
              disabled={busy}
              savingsAreEstimates={bundle.report.savingsAreEstimates}
              onSave={saveOpportunities}
              onGenerate={(fb) => void generateOpportunities(fb)}
              onCancel={() => void window.skillRecorder.cancelDiagnostic()}
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
