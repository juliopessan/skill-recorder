import type { Enablement, Expansion, Initiatives } from "../../common/diagnostic";
import { moveOpportunity, ordered, setOpportunityHidden, type Orderable } from "../diagnostic-view-state";
import { Section } from "./shared";

const FORMAT_LABEL: Record<Enablement["format"], string> = {
  treinamento: "Treinamento",
  workshop: "Workshop",
  letramento: "Letramento",
  mentoria: "Mentoria",
};
const GAP_LABEL: Record<Enablement["gap"], string> = { processos: "processos", dados: "dados", ia: "IA" };

type Kind = "enablement" | "expansion";

function Tools<T extends Orderable>({
  item,
  index,
  count,
  label,
  kind,
  disabled,
  onSave,
}: {
  item: T;
  index: number;
  count: number;
  label: string;
  kind: Kind;
  disabled: boolean;
  onSave: (update: (prev: Initiatives) => Initiatives) => void;
}) {
  const apply = (f: (list: Orderable[]) => Orderable[]) =>
    onSave((prev) => ({ ...prev, [kind]: f(prev[kind] as Orderable[]) }) as Initiatives);
  return (
    <span className="diag-opp-tools">
      <button type="button" className="linky" disabled={disabled || index === 0} aria-label={`Subir ${label}`}
        onClick={() => apply((l) => moveOpportunity(l, item.id, -1))}>Subir</button>
      <button type="button" className="linky" disabled={disabled || index === count - 1} aria-label={`Descer ${label}`}
        onClick={() => apply((l) => moveOpportunity(l, item.id, 1))}>Descer</button>
      <button type="button" className="linky" disabled={disabled}
        onClick={() => apply((l) => setOpportunityHidden(l, item.id, !item.hidden))}>{item.hidden ? "Mostrar" : "Ocultar"}</button>
    </span>
  );
}

/** Enablement (trainings, AI workshops, literacy) and new fronts proposed by the agent. Never money. */
export function InitiativesPanel({
  initiatives,
  disabled,
  onSave,
}: {
  initiatives: Initiatives;
  disabled: boolean;
  onSave: (update: (prev: Initiatives) => Initiatives) => void;
}) {
  const enablement: Enablement[] = ordered(initiatives.enablement);
  const expansion: Expansion[] = ordered(initiatives.expansion);
  return (
    <Section
      title="Capacitação e novas frentes"
      hint="Propostas junto com as oportunidades. Não entram no custo nem na economia; ocultar ou reordenar muda o que entra no relatório."
    >
      <h3 className="diag-subhead">Capacitação: treinamentos e workshops de IA</h3>
      {enablement.length === 0 ? (
        <p className="diag-empty">Nenhuma ação de capacitação. Gere as oportunidades para receber propostas.</p>
      ) : (
        <ol className="diag-opps">
          {enablement.map((x, i) => (
            <li key={x.id} className={`diag-opp ${x.hidden ? "hidden" : ""}`}>
              <div className="diag-opp-top">
                <span className="diag-wave wave-1">{FORMAT_LABEL[x.format]}</span>
                {x.hidden && <span className="diag-source none">oculta do relatório</span>}
                <Tools item={x} index={i} count={enablement.length} label={x.title} kind="enablement" disabled={disabled} onSave={onSave} />
              </div>
              <h3 className="diag-opp-title">{x.title}</h3>
              <p className="diag-opp-rationale">{x.rationale}</p>
              <dl className="diag-facts">
                <div><dt>Público</dt><dd>{x.audience}</dd></div>
                <div><dt>Lacuna</dt><dd>{GAP_LABEL[x.gap]}</dd></div>
                <div><dt>Duração</dt><dd>{x.durationDays} {x.durationDays === 1 ? "dia" : "dias"}</dd></div>
              </dl>
            </li>
          ))}
        </ol>
      )}
      <h3 className="diag-subhead">Novas frentes no cliente</h3>
      {expansion.length === 0 ? (
        <p className="diag-empty">Nenhuma nova frente identificada nas gravações.</p>
      ) : (
        <ol className="diag-opps">
          {expansion.map((x, i) => (
            <li key={x.id} className={`diag-opp ${x.hidden ? "hidden" : ""}`}>
              <div className="diag-opp-top">
                <span className="diag-wave wave-2">Próximo ciclo</span>
                {x.hidden && <span className="diag-source none">oculta do relatório</span>}
                <Tools item={x} index={i} count={expansion.length} label={x.area} kind="expansion" disabled={disabled} onSave={onSave} />
              </div>
              <h3 className="diag-opp-title">{x.area}</h3>
              <p className="diag-opp-rationale">{x.rationale}</p>
              <dl className="diag-facts">
                <div><dt>Evidências</dt><dd>{x.evidence.join(" · ")}</dd></div>
                <div><dt>Aplicativos</dt><dd>{x.relatedApps.join(", ") || "—"}</dd></div>
              </dl>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
