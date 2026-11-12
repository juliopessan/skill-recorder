import { useId, useState } from "react";

import type { Engagement } from "../../common/diagnostic";
import { newId, parseNonNegative } from "../diagnostic-view-state";
import { CommitInput, Section, validateNonNegative } from "./shared";

export function EngagementSetup({
  engagement,
  disabled,
  onChange,
}: {
  engagement: Engagement;
  disabled: boolean;
  onChange: (update: (prev: Engagement) => Engagement) => void;
}) {
  const thesisId = useId();
  const [confirmRoleId, setConfirmRoleId] = useState<string | null>(null);
  const setRole = (id: string, patch: Partial<Engagement["roles"][number]>) =>
    onChange((e) => ({ ...e, roles: e.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const removeRole = (id: string) =>
    onChange((e) => ({
      ...e,
      roles: e.roles.filter((r) => r.id !== id),
      processes: e.processes.map((p) => (p.roleId === id ? { ...p, roleId: undefined } : p)),
    }));
  const usage = (id: string) => engagement.processes.filter((p) => p.roleId === id).length;

  return (
    <>
      <Section title="Cliente" hint="Dados gerais do diagnóstico e a tese exibida no início do relatório.">
        <div className="diag-grid">
          <CommitInput
            label="Nome do cliente"
            value={engagement.clientName}
            disabled={disabled}
            onCommit={(v) => onChange((e) => ({ ...e, clientName: v.trim() || e.clientName }))}
          />
          <CommitInput
            label="Moeda (código ISO)"
            value={engagement.currency}
            disabled={disabled}
            onCommit={(v) => onChange((e) => ({ ...e, currency: v.trim().toUpperCase() || e.currency }))}
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
              const text = e.target.value;
              if (text !== engagement.thesisText) onChange((prev) => ({ ...prev, thesisText: text }));
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
              onChange((e) => ({ ...e, roles: [...e.roles, { id: newId("role"), name: "Novo papel", hourlyCost: 0 }] }))
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
                  validate={validateNonNegative}
                  onCommit={(v) => setRole(r.id, { hourlyCost: parseNonNegative(v) ?? 0 })}
                />
                <span className="diag-unit">{engagement.currency}/h</span>
                {confirmRoleId === r.id ? (
                  <span className="diag-inline-confirm" role="alertdialog" aria-label={`Confirmar remoção do papel ${r.name}`}>
                    {usage(r.id)} {usage(r.id) === 1 ? "processo ficará" : "processos ficarão"} sem papel.
                    <button type="button" className="linky" onClick={() => setConfirmRoleId(null)}>Cancelar</button>
                    <button type="button" className="danger" onClick={() => { setConfirmRoleId(null); removeRole(r.id); }}>Remover</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="linky"
                    disabled={disabled}
                    onClick={() => (usage(r.id) > 0 ? setConfirmRoleId(r.id) : removeRole(r.id))}
                  >
                    Remover
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
