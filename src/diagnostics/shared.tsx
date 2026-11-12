import { useEffect, useId, useState, type ReactNode } from "react";

import type { QuestionnaireAxis, Source } from "../../common/diagnostic";

export function isError<T>(result: T | { error: string }): result is { error: string } {
  return typeof result === "object" && result !== null && "error" in result && typeof (result as { error: unknown }).error === "string";
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
}) {
  const id = useId();
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  useEffect(() => setDraft(value === undefined ? "" : String(value)), [value]);
  const commit = () => {
    if (draft !== (value === undefined ? "" : String(value))) onCommit(draft);
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
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
