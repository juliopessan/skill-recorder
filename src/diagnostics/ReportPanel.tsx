import { formatCurrency, type DiagnosticReport } from "../../common/diagnostic-report";
import { Section } from "./shared";

export function ReportPanel({
  report,
  currency,
  disabled,
  exporting,
  exportNotice,
  onExport,
}: {
  report: DiagnosticReport;
  currency: string;
  disabled: boolean;
  exporting: "html" | "pdf" | null;
  exportNotice: string | null;
  onExport: (format: "html" | "pdf") => void;
}) {
  const suffix = report.draft ? " (rascunho)" : "";
  return (
    <Section
      title="Relatório"
      hint={
        report.draft
          ? "O relatório ainda é um rascunho. Resolva os itens abaixo para torná-lo final; a exportação continua disponível e marcará o documento como rascunho."
          : "Todos os números estão confirmados ou medidos. O relatório será exportado como final."
      }
    >
      <div className="diag-kpis">
        <div className="diag-kpi"><span className="eyebrow">Processos</span><strong>{report.scores.process}<small>/100</small></strong></div>
        <div className="diag-kpi"><span className="eyebrow">Dados</span><strong>{report.scores.data}<small>/100</small></strong></div>
        <div className="diag-kpi"><span className="eyebrow">Prontidão para IA</span><strong>{report.scores.ai}<small>/100</small></strong></div>
        <div className="diag-kpi"><span className="eyebrow">Custo mensal mapeado</span><strong>{formatCurrency(report.totals.monthlyCost, currency, 0)}</strong></div>
        <div className="diag-kpi">
          <span className="eyebrow">Economia mensal{report.savingsAreEstimates ? " (estimada)" : ""}</span>
          <strong>{formatCurrency(report.totals.monthlySavings, currency, 0)}</strong>
        </div>
      </div>

      {report.draft && (
        <div className="diag-draft" role="group" aria-label="Pendências do relatório">
          <div className="diag-draft-head">
            <span className="tag warn">Rascunho</span>
            <span>{report.draftReasons.length} {report.draftReasons.length === 1 ? "pendência" : "pendências"}</span>
          </div>
          <ul className="diag-checklist">
            {report.draftReasons.map((r) => (
              <li key={r}>
                <span className="diag-box" aria-hidden="true" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="diag-actions">
        <button type="button" className="record-cta" disabled={disabled || exporting !== null} onClick={() => onExport("html")}>
          {exporting === "html" ? "Exportando…" : `Exportar HTML${suffix}`}
        </button>
        <button type="button" className="secondary" disabled={disabled || exporting !== null} onClick={() => onExport("pdf")}>
          {exporting === "pdf" ? "Exportando…" : `Exportar PDF${suffix}`}
        </button>
      </div>
      {report.draft && <p className="diag-hint">O relatório será marcado como rascunho enquanto houver pendências.</p>}
      {exportNotice && <p className="diag-hint" role="status">{exportNotice}</p>}
    </Section>
  );
}
