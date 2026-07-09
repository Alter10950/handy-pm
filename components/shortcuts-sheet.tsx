"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { ProfileRole } from "@/lib/supabase/database.types";

// Keyboard shortcuts (design pass v3 F2): "?" opens this cheat sheet,
// "g" + letter jumps between areas. Listener lives here so the AppShell
// stays lean; inputs/textareas/contentEditable are always exempt.

const OFFICE_ROLES: (ProfileRole | null)[] = ["owner", "pm", "scheduler"];

interface Shortcut {
  keys: string;
  label: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

export function ShortcutsSheet({ role }: { role: ProfileRole | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const pendingG = useRef<number | null>(null);

  const office = OFFICE_ROLES.includes(role);
  const gTargets: Record<string, { href: string; label: string }> = {
    p: { href: "/app", label: "Projects" },
    f: { href: "/field", label: "Field" },
    ...(office
      ? {
          d: { href: "/app/dashboard", label: "Dashboard" },
          s: { href: "/scheduler/board", label: "Schedule board" },
          e: { href: "/app/estimate", label: "Estimating" },
        }
      : {}),
    ...(role === "owner" || role === "pm"
      ? { t: { href: "/app/team", label: "Team" } }
      : {}),
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === "?") {
        event.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const target = gTargets[event.key.toLowerCase()];
        if (target) {
          event.preventDefault();
          setOpen(false);
          router.push(target.href);
        }
        return;
      }
      if (event.key.toLowerCase() === "g") {
        // Arm the two-key sequence; disarm if the second key never comes.
        pendingG.current = window.setTimeout(() => {
          pendingG.current = null;
        }, 900);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, router]);

  if (!open) return null;

  const shortcuts: Shortcut[] = [
    { keys: "⌘K / Ctrl+K", label: "Search everything" },
    { keys: "?", label: "Show / hide this sheet" },
    ...Object.entries(gTargets).map(([key, t]) => ({
      keys: `g then ${key}`,
      label: `Go to ${t.label}`,
    })),
    { keys: "Esc", label: "Close dialogs and menus" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      data-testid="shortcuts-sheet"
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-5 shadow-e4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="type-title text-foreground">Keyboard shortcuts</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>
        <ul className="mt-4 flex flex-col gap-2">
          {shortcuts.map((s) => (
            <li
              key={s.keys}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="text-text-secondary">{s.label}</span>
              <kbd className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
