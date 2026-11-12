import { useId } from "react";

import type { Engagement } from "../../common/diagnostic";
import { newId } from "../diagnostic-view-state";
import { CommitInput, Section } from "./shared";

const parseNumber = (s: string): number => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function EngagementSetup({
  engagement,
  disabled,
  onChange,
}: {
  engagement: Engagement;
  disabled: boolean;
  onChange: (next: Engagement) => void | Promise<void>;
}) {
  const thesisId = useId();
  const setRole = (id: string, patch: Partial<Engagement["roles"][number]>) =>
    onChange({ ...engagement, roles: engagement.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const removeRole = (id: string) =>
    onChange({
      ...engagement,
      roles: engagement.roles.filter((r) => r.id !== id),
      processes: engagement.processes.map((p) => (p.roleId === id ? { ...p, roleId: undefined } : p)),
    });

  return (
    <>
      <Section title="Cliente" hint="Dados gerais do diagnóstico e a tese exibida no início do relatório.">
        <div className="diag-grid">
          <CommitInput
            label="Nome do cliente"
            value={engagement.clientName}
            disabled={disabled}
            onCommit={(v) => onChange({ ...engagement, clientName: v.trim() || engagement.clientName })}
          />
          <CommitInput
            label="Moeda (código ISO)"
            value={engagement.currency}
            disabled={disabled}
            onCommit={(v) => onChange({ ...engagement, currency: v.trim().toUpperCase() || engagement.currency })}
          />
        </div>
        <div className="diag-field">
          <label htmlFor={thesisId} className="diag-label">Tese do relatório</label>
          <textarea
            id={thesisId}
            className="overall-fb"
            defaultValue={engagement.thesisText}
            key={engagement.thesisText}
            disabled={disabled}
            onBlur={(e) => {
              if (e.target.value !== engagement.thesisText) void onChange({ ...engagement, thesisText: e.target.value });
            }}
          />
        </div>
      </Section>

      <Section
        title="Papéis"
        hint="Custo/hora total (com encargos) de cada papel. Usado para calcular o custo mensal de cada processo."
        actions={
          <button
            type="button"
            className="ghost"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...engagement,
                roles: [...engagement.roles, { id: newId("role"), name: "Novo papel", hourlyCost: 0 }],
              })
            }
          >
            Adicionar papel
          </button>
        }
      >
        {engagement.roles.length === 0 ? (
          <p className="diag-empty">Nenhum papel definido. Adicione ao menos um para calcular custos.</p>
        ) : (
          <ul className="diag-rows">
            {engagement.roles.map((r) => (
              <li key={r.id} className="diag-row">
                <CommitInput
                  label={`Nome do papel ${r.name}`}
                  hideLabel
                  className="grow"
                  value={r.name}
                  disabled={disabled}
                  onCommit={(v) => setRole(r.id, { name: v.trim() || r.name })}
                />
                <CommitInput
                  label={`Custo por hora de ${r.name} (${engagement.currency})`}
                  hideLabel
                  className="narrow"
                  type="number"
                  min={0}
                  step={1}
                  value={r.hourlyCost}
                  disabled={disabled}
                  onCommit={(v) => setRole(r.id, { hourlyCost: parseNumber(v) })}
                />
                <span className="diag-unit">{engagement.currency}/h</span>
                <button type="button" className="linky" disabled={disabled} onClick={() => removeRole(r.id)}>
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
