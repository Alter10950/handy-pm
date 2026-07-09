"use client";

/** window.print() needs a client boundary — that's this component's whole job. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-primary px-3 py-1 text-sm font-medium text-primary-foreground shadow-e1 transition-colors hover:bg-[var(--brand-hover)]"
    >
      Print / PDF
    </button>
  );
}
