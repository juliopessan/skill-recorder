export type LibraryView = "sessions" | "diagnostics";

export function ViewSwitch({
  view,
  onChange,
  disabled = false,
}: {
  view: LibraryView;
  onChange: (v: LibraryView) => void;
  /** True while a diagnostic generation runs: leaving the view would orphan the job. */
  disabled?: boolean;
}) {
  const items: { id: LibraryView; label: string }[] = [
    { id: "sessions", label: "Sessões" },
    { id: "diagnostics", label: "Diagnósticos" },
  ];
  return (
    <div className="diag-switch" role="group" aria-label="Visão da biblioteca">
      {items.map((it) => {
        const blocked = disabled && view !== it.id;
        return (
          <button
            key={it.id}
            type="button"
            className={view === it.id ? "on" : ""}
            aria-pressed={view === it.id}
            disabled={blocked}
            title={blocked ? "Aguarde a geração terminar ou cancele-a para trocar de visão." : undefined}
            onClick={() => onChange(it.id)}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
