import type { Engagement, Opportunity } from "../../common/diagnostic";
import { formatCurrency, formatPayback, type DiagnosticReport } from "../../common/diagnostic-report";
import { parseNonNegative, setSquadRate, squadRateRows, squadReturnWarning } from "../diagnostic-view-state";
import { CommitInput, Section, validateOptionalNonNegative } from "./shared";

/**
 * Weekly rate per squad role (consultant-entered; blank = not informed) and the optional enablement
 * day rate. Every figure shown comes from the report model; edits go through the updater queue.
 */
export function SquadRates({
  engagement,
  opportunities,
  report,
  disabled,
  onChange,
}: {
  engagement: Engagement;
  /** Every stored opportunity; hidden ones are ignored when listing roles. */
  opportunities: Opportunity[];
  report: DiagnosticReport;
  disabled: boolean;
  onChange: (update: (prev: Engagement) => Engagement) => void;
}) {
  const cur = engagement.currency;
  const rows = squadRateRows(opportunities, engagement.squadRates);
  const inv = report.investment;
  const warning = squadReturnWarning(inv);
  const setRate = (role: string, text: string) =>
    onChange((e) => ({ ...e, squadRates: setSquadRate(e.squadRates, role, parseNonNegative(text)) }));

  return (
    <Section
      title="Tarifas do squad"
      hint="Quanto custa por semana cada perfil sugerido nas oportunidades. Só você informa esses valores: a IA e o aplicativo nunca os inventam. Deixe em branco o que ainda não souber; sem tarifa, o investimento e o payback não são calculados."
    >
      {rows.length === 0 ? (
        <p className="diag-empty">Nenhum perfil de squad nas oportunidades visíveis. Gere as oportunidades para listar os perfis.</p>
      ) : (
        <ul className="diag-rows">
          {rows.map((r) => (
            <li key={r.role.toLowerCase()} className="diag-row">
              <span className="diag-rate-role">
                {r.role}
                {!r.inUse && <span className="diag-hint"> · não usado nas oportunidades visíveis</span>}
              </span>
              <CommitInput
                label={`Tarifa semanal de ${r.role} (${cur})`}
                hideLabel
                className="narrow"
                type="number"
                min={0}
                step={100}
                placeholder="a informar"
                value={r.weeklyRate ?? ""}
                disabled={disabled}
                validate={validateOptionalNonNegative}
                onCommit={(v) => setRate(r.role, v)}
              />
              <span className="diag-unit">{cur}/semana</span>
            </li>
          ))}
        </ul>
      )}

      <div className="diag-row diag-row-end">
        <CommitInput
          label={`Capacitação: custo por dia (${cur}) — opcional`}
          className="wide"
          type="number"
          min={0}
          step={100}
          placeholder="a informar"
          value={engagement.enablementDayRate ?? ""}
          disabled={disabled}
          validate={validateOptionalNonNegative}
          onCommit={(v) => onChange((e) => ({ ...e, enablementDayRate: parseNonNegative(v) ?? undefined }))}
        />
        <span className="diag-unit diag-unit-end">{cur}/dia · se informado, entra no investimento</span>
      </div>

      <div className="diag-kpis">
        <div className="diag-kpi">
          <span className="eyebrow">Investimento do programa</span>
          <strong>{inv.total === null ? "Não calculado" : formatCurrency(inv.total, cur, 0)}</strong>
        </div>
        <div className="diag-kpi">
          <span className="eyebrow">Payback</span>
          <strong>{formatPayback(inv.paybackMonths, inv.paybackOverCap)}</strong>
        </div>
        <div className="diag-kpi">
          <span className="eyebrow">Resultado em 36 meses</span>
          <strong>{inv.netOver36Months === null ? "—" : formatCurrency(inv.netOver36Months, cur, 0)}</strong>
        </div>
      </div>
      {inv.note && <p className="diag-hint">Não calculado: {inv.note}{inv.missingRoles.length ? ` (${inv.missingRoles.join(", ")})` : ""}.</p>}
      {warning && <p className="diag-warn" role="alert">{warning}</p>}
    </Section>
  );
}
