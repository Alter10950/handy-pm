"use client";

import { useSyncExternalStore } from "react";

// Light is the product's default theme; dark is the secondary opt-in
// (Phase 10). The html class is the source of truth — the root layout's
// pre-paint script sets it from localStorage, this toggle flips both.
const THEME_KEY = "handy-pm:theme";
const THEME_EVENT = "handy-pm:theme-change";

function subscribe(callback: () => void): () => void {
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function readTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light");

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private-mode storage failures shouldn't break the toggle.
    }
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className={
        className ??
        "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      }
    >
      {theme === "dark" ? (
        // Sun
        <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
          <circle cx="7.5" cy="7.5" r="3.25" />
          <path
            d="M7.5 0v2M7.5 13v2M0 7.5h2M13 7.5h2M2.2 2.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 2.2l-1.4 1.4M3.6 11.4l-1.4 1.4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        // Moon
        <svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden>
          <path d="M13.2 9.4A6.1 6.1 0 0 1 5.6 1.8a6.1 6.1 0 1 0 7.6 7.6Z" />
        </svg>
      )}
    </button>
  );
}
