import { useId, useState } from "react";

import type { Engagement, Process, ProcessMap, SourcedNumber } from "../../common/diagnostic";
import { formatCurrency, type ReportProcess } from "../../common/diagnostic-report";
import type { SessionSummary } from "../../common/ipc";
import { canGenerateMap, confirmField, newId, parseNonNegative } from "../diagnostic-view-state";
import { formatDur, formatWhen } from "../format";
import { CommitInput, GenerateControls, Section, SourceBadge, validateNonNegative, type GenerationState } from "./shared";

export type { GenerationState };

type Update<T> = (prev: T) => T;

const CONFIDENCE_LABEL: Record<ProcessMap["confidence"], string> = { high: "alta", medium: "média", low: "baixa" };
const STRUCTURE_LABEL = { structured: "estruturado", semi: "semi-estruturado", unstructured: "não estruturado" } as const;

function SourcedInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: SourcedNumber | undefined;
  disabled: boolean;
  onChange: (update: Update<SourcedNumber | undefined>) => void;
}) {
  return (
    <div className="diag-sourced">
      <CommitInput
        label={label}
        type="number"
        min={0}
        step={1}
        value={value?.value}
        disabled={disabled}
        validate={validateNonNegative}
        onCommit={(v) => {
          const n = parseNonNegative(v);
          if (n !== null) onChange((prev) => confirmField(prev ?? { value: n, source: "confirmed" }, n));
        }}
      />
      <div className="diag-sourced-meta">
        {value ? <SourceBadge source={value.source} /> : <span className="diag-source none">sem valor</span>}
        {value && value.source !== "confirmed" && (
          <button type="button" className="linky" disabled={disabled} onClick={() => onChange((prev) => confirmField(prev ?? value))}>
            Confirmar valor
          </button>
        )}
      </div>
    </div>
  );
}

function ProcessCard({
  engagement,
  process,
  report,
  map,
  sessions,
  analyzedIds,
  generation,
  disabled,
  onChange,
  onRemove,
  onGenerate,
  onCancel,
}: {
  engagement: Engagement;
  process: Process;
  report: ReportProcess | undefined;
  map: ProcessMap | undefined;
  sessions: SessionSummary[];
  analyzedIds: ReadonlySet<string>;
  generation: GenerationState;
  disabled: boolean;
  onChange: (update: Update<Process>) => void;
  onRemove: () => void;
  onGenerate: (feedback: string) => void;
  onCancel: () => void;
}) {
  const roleId = useId();
  const feedbackId = useId();
  const [feedback, setFeedback] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const anyRunning = generation.running !== null;
  const gate = canGenerateMap(process, analyzedIds);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const linkable = sessions.filter((s) => s.analysis);
  const orphaned = process.sessionIds.filter((id) => !byId.get(id)?.analysis);

  const toggleSession = (id: string) =>
    onChange((p) => ({
      ...p,
      sessionIds: p.sessionIds.includes(id) ? p.sessionIds.filter((x) => x !== id) : [...p.sessionIds, id],
    }));

  return (
    <article className="diag-process" aria-label={`Processo ${process.name}`}>
      <header className="diag-process-head">
        <CommitInput
          label="Nome do processo"
          hideLabel
          className="grow diag-process-name"
          value={process.name}
          disabled={disabled}
          onCommit={(v) => onChange((p) => ({ ...p, name: v.trim() || p.name }))}
        />
        <div className="diag-process-stats">
          {process.stale && <span className="diag-source stale">mapa desatualizado</span>}
          {report?.score !== undefined && <span className="pill" title="Score do processo">{report.score}/100</span>}
          {report && map && <span className="pill" title="Custo mensal mapeado">{formatCurrency(report.monthlyCost, engagement.currency)}/mês</span>}
        </div>
        {confirmRemove ? (
          <span className="diag-inline-confirm" role="alertdialog" aria-label={`Confirmar remoção de ${process.name}`}>
            Remover este processo e seu mapa?
            <button type="button" className="linky" onClick={() => setConfirmRemove(false)}>Cancelar</button>
            <button type="button" className="danger" onClick={() => { setConfirmRemove(false); onRemove(); }}>Remover</button>
          </span>
        ) : (
          <button type="button" className="linky" disabled={disabled} onClick={() => setConfirmRemove(true)}>
            Remover processo
          </button>
        )}
      </header>

      <div className="diag-grid">
        <CommitInput
          label="Responsável (área)"
          value={process.owner}
          disabled={disabled}
          onCommit={(v) => onChange((p) => ({ ...p, owner: v.trim() || undefined }))}
        />
        <div className="diag-field">
          <label htmlFor={roleId} className="diag-label">Papel principal</label>
          <select
            id={roleId}
            className="fb-input"
            value={process.roleId ?? ""}
            disabled={disabled}
            onChange={(e) => {
              const roleId = e.target.value || undefined;
              onChange((p) => ({ ...p, roleId }));
            }}
          >
            <option value="">Sem papel definido</option>
            {engagement.roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({formatCurrency(r.hourlyCost, engagement.currency, 0)}/h)</option>
            ))}
          </select>
        </div>
        <SourcedInput
          label="Volume mensal (execuções)"
          value={process.volumePerMonth}
          disabled={disabled}
          onChange={(u) => onChange((p) => ({ ...p, volumePerMonth: u(p.volumePerMonth) }))}
        />
        <SourcedInput
          label="Pessoas envolvidas"
          value={process.peopleCount}
          disabled={disabled}
          onChange={(u) => onChange((p) => ({ ...p, peopleCount: u(p.peopleCount) }))}
        />
      </div>

      <fieldset className="diag-sessions" disabled={disabled}>
        <legend className="diag-label">Gravações vinculadas</legend>
        {linkable.length === 0 ? (
          <p className="diag-empty">Nenhuma gravação analisada. Analise uma gravação na visão Sessões para vinculá-la.</p>
        ) : (
          <ul className="diag-session-list">
            {linkable.map((s) => (
              <li key={s.id}>
                <label className="diag-check">
                  <input type="checkbox" checked={process.sessionIds.includes(s.id)} onChange={() => toggleSession(s.id)} />
                  <span className="diag-check-title">{s.analysis?.title || s.analysis?.intent || s.id}</span>
                  <span className="diag-check-meta">
                    {formatWhen(s.startedAt)} · {s.analysis?.stepCount} passos
                    {s.durationMs ? ` · ${formatDur(s.durationMs)}` : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {orphaned.length > 0 && (
          <p className="diag-warn">
            {orphaned.length} {orphaned.length === 1 ? "gravação vinculada não está" : "gravações vinculadas não estão"} mais
            disponíveis com análise.{" "}
            <button type="button" className="linky" onClick={() => onChange((p) => ({ ...p, sessionIds: p.sessionIds.filter((id) => !orphaned.includes(id)) }))}>
              Desvincular
            </button>
          </p>
        )}
      </fieldset>

      <div className="diag-map">
        <div className="diag-map-head">
          <span className="diag-label">Mapa do processo</span>
          {map ? (
            <span className="diag-hint">
              revisão {map.revision} · {map.steps.length} passos · confiança {CONFIDENCE_LABEL[map.confidence]}
            </span>
          ) : (
            <span className="diag-hint">Ainda não gerado.</span>
          )}
        </div>
        {map && (
          <ol className="diag-steps">
            {map.steps.map((s) => (
              <li key={s.id}>
                <span className="diag-step-title">{s.title}</span>
                <span className="diag-step-meta">
                  {s.medianDurationMs != null ? formatDur(s.medianDurationMs) : "—"} · {STRUCTURE_LABEL[s.dataStructure]}
                  {s.manualTransfer && <span className="diag-flag">transferência manual</span>}
                  {s.rework && <span className="diag-flag">retrabalho</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
        {map && (
          <div className="diag-field">
            <label htmlFor={feedbackId} className="diag-label">Ajustes para a próxima geração (opcional)</label>
            <textarea
              id={feedbackId}
              className="overall-fb"
              value={feedback}
              disabled={anyRunning}
              placeholder="Ex.: unir os passos 2 e 3; o passo 5 é feito pelo financeiro."
              onChange={(e) => setFeedback(e.target.value)}
            />
          </div>
        )}
        {gate.reason && <p className={gate.ok ? "diag-hint" : "diag-warn"}>{gate.reason}</p>}
        <GenerateControls
          scope={process.id}
          generation={generation}
          label={map ? "Regenerar mapa" : "Gerar mapa"}
          runningLabel="Gerando mapa…"
          disabled={disabled || !gate.ok}
          onGenerate={() => onGenerate(feedback.trim())}
          onCancel={onCancel}
        />
      </div>
    </article>
  );
}

export function ProcessesSection({
  engagement,
  report,
  maps,
  sessions,
  generation,
  disabled,
  onChange,
  onGenerate,
  onCancel,
}: {
  engagement: Engagement;
  report: ReportProcess[];
  maps: Record<string, ProcessMap>;
  sessions: SessionSummary[];
  generation: GenerationState;
  disabled: boolean;
  onChange: (update: Update<Engagement>) => void;
  onGenerate: (processId: string, feedback: string) => void;
  onCancel: () => void;
}) {
  const analyzedIds = new Set(sessions.filter((s) => s.analysis).map((s) => s.id));
  const replace = (id: string, update: Update<Process>) =>
    onChange((e) => ({ ...e, processes: e.processes.map((p) => (p.id === id ? update(p) : p)) }));
  return (
    <Section
      title="Processos"
      hint="Cada processo reúne gravações analisadas, o papel responsável e a linha de base (volume e pessoas). O mapa é gerado a partir das gravações vinculadas."
      actions={
        <button
          type="button"
          className="ghost"
          disabled={disabled}
          onClick={() =>
            onChange((e) => ({
              ...e,
              processes: [...e.processes, { id: newId("proc"), name: "Novo processo", sessionIds: [], stale: false }],
            }))
          }
        >
          Adicionar processo
        </button>
      }
    >
      {engagement.processes.length === 0 ? (
        <p className="diag-empty">Nenhum processo ainda. Adicione o primeiro para vincular gravações.</p>
      ) : (
        <div className="diag-process-list">
          {engagement.processes.map((p) => (
            <ProcessCard
              key={p.id}
              engagement={engagement}
              process={p}
              report={report.find((r) => r.id === p.id)}
              map={maps[p.id]}
              sessions={sessions}
              analyzedIds={analyzedIds}
              generation={generation}
              disabled={disabled}
              onChange={(u) => replace(p.id, u)}
              onRemove={() => onChange((e) => ({ ...e, processes: e.processes.filter((x) => x.id !== p.id) }))}
              onGenerate={(fb) => onGenerate(p.id, fb)}
              onCancel={onCancel}
            />
          ))}
        </div>
      )}
    </Section>
  );
}
