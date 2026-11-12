import type { DataQuestionnaire, QuestionnaireAxis } from "../../common/diagnostic";
import { AXES } from "../diagnostic-view-state";
import { AXIS_LABELS, LEVEL_LABELS, Section, SourceBadge } from "./shared";

const LEVELS = [1, 2, 3, 4] as const;

export function QuestionnaireForm({
  questionnaire,
  disabled,
  onChange,
  onSuggest,
  hasMaps,
}: {
  questionnaire: DataQuestionnaire;
  disabled: boolean;
  onChange: (next: DataQuestionnaire) => void | Promise<void>;
  onSuggest: () => void | Promise<void>;
  hasMaps: boolean;
}) {
  const set = (axis: QuestionnaireAxis, patch: Partial<NonNullable<DataQuestionnaire[QuestionnaireAxis]>>) => {
    const current = questionnaire[axis] ?? { answer: 1 as const, source: "confirmed" as const, evidence: [] };
    return onChange({ ...questionnaire, [axis]: { ...current, ...patch } });
  };

  return (
    <Section
      title="Prontidão dos dados"
      hint="Cinco eixos, de 1 (inicial) a 4 (pronto). Respostas sugeridas pelas gravações aparecem destacadas até você confirmá-las."
      actions={
        <button
          type="button"
          className="ghost"
          disabled={disabled || !hasMaps}
          title={hasMaps ? undefined : "Gere ao menos um mapa de processo primeiro."}
          onClick={() => void onSuggest()}
        >
          Sugerir a partir das gravações
        </button>
      }
    >
      <div className="diag-axes">
        {AXES.map((axis) => {
          const a = questionnaire[axis];
          const pending = a !== undefined && a.source !== "confirmed";
          const name = `diag-axis-${axis}`;
          return (
            <fieldset key={axis} className={`diag-axis ${pending ? "pending" : ""}`} disabled={disabled}>
              <legend className="diag-axis-legend">
                <span>{AXIS_LABELS[axis].name}</span>
                {a ? <SourceBadge source={a.source} /> : <span className="diag-source none">sem resposta</span>}
              </legend>
              <p className="diag-hint">{AXIS_LABELS[axis].question}</p>
              <div className="diag-levels" role="radiogroup" aria-label={`Nível de ${AXIS_LABELS[axis].name}`}>
                {LEVELS.map((n) => (
                  <label key={n} className={`diag-level ${a?.answer === n ? "on" : ""}`}>
                    <input
                      type="radio"
                      name={name}
                      value={n}
                      checked={a?.answer === n}
                      onChange={() => void set(axis, { answer: n, source: "confirmed" })}
                    />
                    <span className="diag-level-n">{n}</span>
                    <span>{LEVEL_LABELS[n]}</span>
                  </label>
                ))}
              </div>
              {a && a.evidence.length > 0 && (
                <ul className="diag-evidence">
                  {a.evidence.map((ev) => <li key={ev}>{ev}</li>)}
                </ul>
              )}
              {pending && (
                <button type="button" className="ghost diag-confirm" onClick={() => void set(axis, { source: "confirmed" })}>
                  Confirmar resposta
                </button>
              )}
            </fieldset>
          );
        })}
      </div>
    </Section>
  );
}
