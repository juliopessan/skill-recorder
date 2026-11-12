import { useState } from "react";

import type { Engagement } from "../../common/diagnostic";
import { formatWhen } from "../format";

export function EngagementList({
  engagements,
  loaded,
  selectedId,
  disabled,
  onSelect,
  onCreate,
  onDelete,
}: {
  engagements: Engagement[];
  loaded: boolean;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onCreate: (clientName: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <>
      <form
        className="diag-new"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          setName("");
          void onCreate(trimmed);
        }}
      >
        <label htmlFor="diag-new-client" className="diag-label">Novo diagnóstico</label>
        <div className="diag-new-row">
          <input
            id="diag-new-client"
            className="fb-input"
            value={name}
            placeholder="Nome do cliente"
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
          />
          <button type="submit" className="record-cta diag-add" disabled={disabled || !name.trim()}>
            Criar
          </button>
        </div>
      </form>
      <div className="lib-list-scroll">
        {engagements.length === 0 ? (
          <p className="sessions-empty">{loaded ? "Nenhum diagnóstico ainda." : "Carregando…"}</p>
        ) : (
          <ul className="sess-list">
            {engagements.map((e) =>
              confirmId === e.id ? (
                <li key={e.id}>
                  <div className="sess-confirm" role="alertdialog" aria-label="Confirmar exclusão do diagnóstico">
                    <div className="sess-confirm-text">
                      <span className="sess-confirm-title">Excluir o diagnóstico de {e.clientName}?</span>
                      <span className="sess-confirm-sub">
                        Mapas e oportunidades também serão removidos. Esta ação não pode ser desfeita.
                      </span>
                    </div>
                    <div className="sess-confirm-actions">
                      <button type="button" className="linky" onClick={() => setConfirmId(null)}>Cancelar</button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setConfirmId(null);
                          void onDelete(e.id);
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                </li>
              ) : (
                <li key={e.id}>
                  <div className="sess-row">
                    <button
                      type="button"
                      className={`sess ${e.id === selectedId ? "on" : ""}`}
                      disabled={disabled && e.id !== selectedId}
                      onClick={() => onSelect(e.id)}
                    >
                      <div className="sess-top">
                        <span className="sess-when">{e.clientName || "Sem nome"}</span>
                      </div>
                      <div className="diag-eng-meta">
                        {e.processes.length} {e.processes.length === 1 ? "processo" : "processos"} · {formatWhen(e.createdAt)}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="sess-del"
                      aria-label={`Excluir diagnóstico de ${e.clientName}`}
                      title="Excluir"
                      disabled={disabled}
                      onClick={() => setConfirmId(e.id)}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </>
  );
}
