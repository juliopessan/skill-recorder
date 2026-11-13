import { useEffect, useId, useState, type ReactNode } from "react";

import type { QuestionnaireAxis, Source } from "../../common/diagnostic";
import { parseNonNegative } from "../diagnostic-view-state";

export function isError<T>(result: T | { error: string }): result is { error: string } {
  return typeof result === "object" && result !== null && "error" in result && typeof (result as { error: unknown }).error === "string";
}

export const BRIDGE_FAILED_MESSAGE = "Não foi possível concluir a operação. Tente novamente.";

/** Runs a bridge call and turns a rejected promise into the same `{ error }` shape the bridge returns. */
export async function safeCall<T>(call: () => Promise<T | { error: string }>): Promise<T | { error: string }> {
  try {
    return await call();
  } catch (error) {
    console.error("Diagnostic bridge call failed:", error);
    return { error: BRIDGE_FAILED_MESSAGE };
  }
}

export const NUMBER_ERROR = "Informe um número maior ou igual a zero.";
export const validateNonNegative = (text: string): string | null => (parseNonNegative(text) === null ? NUMBER_ERROR : null);

/** Like validateNonNegative, but a blank field is valid (it means "not informed"). */
export const validateOptionalNonNegative = (text: string): string | null =>
  text.trim() === "" ? null : validateNonNegative(text);

export interface GenerationState {
  /** What is running, or null when idle. */
  running: { kind: "map"; processId: string } | { kind: "opportunities" } | null;
  progress: string | null;
  /** Last failure, scoped so "Tentar novamente" shows on the right card. */
  failure: { scope: string; message: string; retry: () => void } | null;
}

/** Generate button, or progress + Cancelar while this scope runs; plus the failure with "Tentar novamente". */
export function GenerateControls({
  scope,
  generation,
  label,
  runningLabel,
  disabled,
  onGenerate,
  onCancel,
}: {
  scope: string;
  generation: GenerationState;
  label: string;
  runningLabel: string;
  /** Extra reason the button cannot be used (blocked inputs, saving state). */
  disabled: boolean;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const running = generation.running;
  const thisRunning = running !== null && (running.kind === "map" ? running.processId === scope : scope === "opportunities");
  const failure = generation.failure?.scope === scope ? generation.failure : null;
  return (
    <>
      <div className="diag-actions">
        {thisRunning ? (
          <>
            <span className="status-line diag-progress" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <span className="status-text">{generation.progress ?? runningLabel}</span>
            </span>
            <button type="button" className="ghost" onClick={onCancel}>Cancelar</button>
          </>
        ) : (
          <button type="button" className="record-cta" disabled={disabled || running !== null} onClick={onGenerate}>
            {label}
          </button>
        )}
      </div>
      {failure && (
        <div className="diag-error" role="alert">
          <span>{failure.message}</span>
          <button type="button" className="ghost" disabled={running !== null} onClick={failure.retry}>Tentar novamente</button>
        </div>
      )}
    </>
  );
}

export const AXIS_LABELS: Record<QuestionnaireAxis, { name: string; question: string }> = {
  inventory: { name: "Inventário", question: "A organização sabe quais dados e sistemas possui?" },
  structure: { name: "Estrutura", question: "Os dados estão em formatos estruturados e padronizados?" },
  quality: { name: "Qualidade", question: "Os dados são completos, corretos e consistentes?" },
  access: { name: "Acesso", question: "Os dados podem ser acessados de forma programática (APIs, exportações)?" },
  governance: { name: "Governança", question: "Há donos, regras e controles definidos para os dados?" },
};

export const LEVEL_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: "Inicial",
  2: "Parcial",
  3: "Bom",
  4: "Pronto",
};

export const SOURCE_LABELS: Record<Source, string> = {
  measured: "medido",
  "ai-suggested": "sugerido pela IA",
  confirmed: "confirmado",
};

export function SourceBadge({ source }: { source: Source }) {
  return <span className={`diag-source ${source}`}>{SOURCE_LABELS[source]}</span>;
}

export function Section({
  title,
  hint,
  actions,
  children,
  id,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section className="diag-section" aria-labelledby={headingId} id={id}>
      <header className="diag-section-head">
        <div>
          <h2 id={headingId} className="diag-h2">{title}</h2>
          {hint && <p className="diag-hint">{hint}</p>}
        </div>
        {actions && <div className="diag-section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** Text or numeric input that keeps a local draft and commits on blur / Enter. */
export function CommitInput({
  label,
  value,
  onCommit,
  type = "text",
  min,
  step,
  disabled,
  className,
  hideLabel,
  placeholder,
  validate,
}: {
  label: string;
  value: string | number | undefined;
  onCommit: (next: string) => void;
  type?: "text" | "number";
  min?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  hideLabel?: boolean;
  placeholder?: string;
  /** Returns a pt-BR message when the typed text is invalid; the draft then reverts to the stored value. */
  validate?: (draft: string) => string | null;
}) {
  const id = useId();
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  useEffect(() => setDraft(value === undefined ? "" : String(value)), [value]);
  const stored = value === undefined ? "" : String(value);
  const commit = () => {
    const message = validate?.(draft) ?? null;
    if (message && draft !== stored) {
      setError(message);
      setDraft(stored);
      return;
    }
    if (draft !== stored) onCommit(draft);
  };
  return (
    <div className={`diag-field ${className ?? ""}`}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "diag-label"}>{label}</label>
      <input
        id={id}
        className="fb-input"
        type={type}
        min={min}
        step={step}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {error && <span id={errorId} className="diag-field-error" role="alert">{error}</span>}
    </div>
  );
}
