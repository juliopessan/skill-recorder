export type LibraryView = "sessions" | "diagnostics";

export function ViewSwitch({ view, onChange }: { view: LibraryView; onChange: (v: LibraryView) => void }) {
  const items: { id: LibraryView; label: string }[] = [
    { id: "sessions", label: "Sessões" },
    { id: "diagnostics", label: "Diagnósticos" },
  ];
  return (
    <div className="diag-switch" role="group" aria-label="Visão da biblioteca">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={view === it.id ? "on" : ""}
          aria-pressed={view === it.id}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
