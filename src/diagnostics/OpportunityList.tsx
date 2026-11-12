import { useId, useState } from "react";

import type { Opportunity } from "../../common/diagnostic";
import { formatCurrency, type ReportOpportunity } from "../../common/diagnostic-report";
import { confirmField, moveOpportunity, ordered, setOpportunityHidden } from "../diagnostic-view-state";
import { GenerateControls, Section, SourceBadge, type GenerationState } from "./shared";

const WAVE_LABEL: Record<1 | 2 | 3, string> = { 1: "Onda 1 · dados", 2: "Onda 2 · automação", 3: "Onda 3 · IA" };
const EFFORT_LABEL = { S: "esforço pequeno", M: "esforço médio", L: "esforço grande" } as const;
const RISK_LABEL = { low: "risco baixo", medium: "risco médio", high: "risco alto" } as const;
const pct = (r: number): string => `${Math.round(r * 100)}%`;

export function OpportunityList({
  opportunities,
  report,
  currency,
  processNames,
  hasMaps,
  generation,
  disabled,
  savingsAreEstimates,
  onSave,
  onGenerate,
  onCancel,
}: {
  /** Every stored opportunity, hidden ones included. */
  opportunities: Opportunity[];
  /** Report-model rows (visible only) keyed by id: source of readiness, savings and quick-win. */
  report: ReportOpportunity[];
  currency: string;
  /** Process id to display name, so hidden opportunities (absent from the report) still read well. */
  processNames: Record<string, string>;
  hasMaps: boolean;
  generation: GenerationState;
  disabled: boolean;
  savingsAreEstimates: boolean;
  onSave: (update: (prev: Opportunity[]) => Opportunity[]) => void;
  onGenerate: (feedback: string) => void;
  onCancel: () => void;
}) {
  const feedbackId = useId();
  const [feedback, setFeedback] = useState("");
  const [confirming, setConfirming] = useState(false);
  const sorted = ordered(opportunities);
  const rows = new Map(report.map((r) => [r.id, r]));
  const titles = new Map(opportunities.map((o) => [o.id, o.title]));
  const anyRunning = generation.running !== null;

  return (
    <Section
      title="Oportunidades"
      hint="Priorizadas em ondas: primeiro os dados, depois a automação e, por fim, a IA. Ocultar ou reordenar muda o que entra no relatório."
    >
      {sorted.length === 0 ? (
        <p className="diag-empty">Nenhuma oportunidade ainda.</p>
      ) : (
        <>
          {savingsAreEstimates && (
            <p className="diag-hint">As economias abaixo são estimativas sugeridas pela IA, limitadas pelo teto de cada onda, até serem confirmadas.</p>
          )}
          <ol className="diag-opps">
            {sorted.map((o, i) => {
              const r = rows.get(o.id);
              return (
                <li key={o.id} className={`diag-opp wave-${o.wave} ${o.hidden ? "hidden" : ""}`}>
                  <div className="diag-opp-top">
                    <span className={`diag-wave wave-${o.wave}`}>{WAVE_LABEL[o.wave]}</span>
                    {r?.quickWin && <span className="diag-quick">Ganho rápido</span>}
                    {o.hidden && <span className="diag-source none">oculta do relatório</span>}
                    <span className="diag-opp-tools">
                      <button
                        type="button"
                        className="linky"
                        disabled={disabled || i === 0}
                        aria-label={`Subir ${o.title}`}
                        onClick={() => onSave((prev) => moveOpportunity(prev, o.id, -1))}
                      >
                        Subir
                      </button>
                      <button
                        type="button"
                        className="linky"
                        disabled={disabled || i === sorted.length - 1}
                        aria-label={`Descer ${o.title}`}
                        onClick={() => onSave((prev) => moveOpportunity(prev, o.id, 1))}
                      >
                        Descer
                      </button>
                      <button
                        type="button"
                        className="linky"
                        disabled={disabled}
                        onClick={() => onSave((prev) => setOpportunityHidden(prev, o.id, !o.hidden))}
                      >
                        {o.hidden ? "Mostrar" : "Ocultar"}
                      </button>
                    </span>
                  </div>
                  <h3 className="diag-opp-title">{o.title}</h3>
                  <p className="diag-opp-rationale">{o.rationale}</p>
                  <dl className="diag-facts">
                    <div><dt>Processo</dt><dd>{r?.processName ?? processNames[o.processId] ?? "Processo removido"}</dd></div>
                    <div><dt>Esforço / risco</dt><dd>{EFFORT_LABEL[o.effort]} · {RISK_LABEL[o.risk]}</dd></div>
                    {r ? (
                      <>
                        <div>
                          <dt>Economia mensal</dt>
                          <dd>
                            {formatCurrency(r.monthlySavings, currency)}
                            <span className="diag-fact-note">
                              {" "}({pct(r.appliedPct)} aplicado{r.capped ? ", limitado pelo teto da onda" : ""})
                            </span>
                          </dd>
                        </div>
                        <div><dt>Prontidão</dt><dd>{r.readiness}/100</dd></div>
                      </>
                    ) : (
                      <div><dt>Economia mensal</dt><dd className="diag-fact-note">fora do relatório</dd></div>
                    )}
                    <div>
                      <dt>Economia pedida</dt>
                      <dd className="diag-fact-line">
                        <span>{pct(o.estimatedSavingsPct.value)}</span> <SourceBadge source={o.estimatedSavingsPct.source} />
                        {o.estimatedSavingsPct.source !== "confirmed" && (
                          <button
                            type="button"
                            className="linky diag-inline-btn"
                            disabled={disabled}
                            onClick={() =>
                              onSave((prev) => prev.map((x) => (x.id === o.id ? { ...x, estimatedSavingsPct: confirmField(x.estimatedSavingsPct) } : x)))
                            }
                          >
                            Confirmar
                          </button>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Equipe sugerida</dt>
                      <dd>{o.suggestedSquad.roles.join(", ") || "—"} · {o.suggestedSquad.weeks} sem.</dd>
                    </div>
                  </dl>
                  <div className="diag-prereq">
                    <span className="diag-label">Pré-requisitos</span>
                    {o.prerequisites.length === 0 ? (
                      <span className="diag-hint">nenhum</span>
                    ) : (
                      <ul>
                        {o.prerequisites.map((p) => <li key={p}>{titles.get(p) ?? p}</li>)}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="diag-field">
        <label htmlFor={feedbackId} className="diag-label">Ajustes para a próxima geração (opcional)</label>
        <textarea
          id={feedbackId}
          className="overall-fb"
          value={feedback}
          disabled={anyRunning}
          placeholder="Ex.: priorizar a conciliação; evitar propostas que dependam de integração com o ERP."
          onChange={(e) => setFeedback(e.target.value)}
        />
      </div>
      {!hasMaps && <p className="diag-warn">Gere ao menos um mapa de processo antes de gerar oportunidades.</p>}
      {confirming ? (
        <div className="diag-error" role="alertdialog" aria-label="Confirmar nova geração de oportunidades">
          <span>
            Gerar de novo substitui as oportunidades atuais: o que você ocultou e a ordem escolhida serão perdidos. Continuar?
          </span>
          <span className="diag-inline-confirm">
            <button type="button" className="linky" onClick={() => setConfirming(false)}>Cancelar</button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setConfirming(false);
                onGenerate(feedback.trim());
              }}
            >
              Substituir
            </button>
          </span>
        </div>
      ) : (
        <GenerateControls
          scope="opportunities"
          generation={generation}
          label={sorted.length > 0 ? "Regenerar oportunidades" : "Gerar oportunidades"}
          runningLabel="Gerando oportunidades…"
          disabled={disabled || !hasMaps}
          onGenerate={() => (sorted.length > 0 ? setConfirming(true) : onGenerate(feedback.trim()))}
          onCancel={onCancel}
        />
      )}
    </Section>
  );
}
