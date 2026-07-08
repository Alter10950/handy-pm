"use client";

import { useSyncExternalStore } from "react";

import { ComponentGallery } from "@/components/styleguide/component-gallery";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ── WCAG contrast math (relative luminance) — ratios rendered live so
// the palette documents its own AA compliance (Phase 10.5 / 16 a11y). ──
function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const raw =
    m[1].length === 3
      ? m[1]
          .split("")
          .map((c) => c + c)
          .join("")
      : m[1];
  const n = parseInt(raw, 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}
function contrast(a: string, b: string): string {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return "—";
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return `${ratio.toFixed(2)}:1`;
}

const SURFACE_TOKENS = [
  "--background",
  "--surface",
  "--surface-sunken",
  "--card",
  "--popover",
  "--stage",
] as const;
const TEXT_TOKENS = [
  "--foreground",
  "--text-secondary",
  "--muted-foreground",
] as const;
const BRAND_TOKENS = [
  "--brand",
  "--brand-hover",
  "--brand-pressed",
  "--brand-subtle",
] as const;
const SEMANTIC_TOKENS = [
  "--success",
  "--success-subtle",
  "--success-fg",
  "--warning",
  "--warning-subtle",
  "--warning-fg",
  "--destructive",
  "--destructive-subtle",
  "--destructive-fg",
  "--info",
  "--info-subtle",
  "--info-fg",
] as const;
const BORDER_TOKENS = ["--border-subtle", "--border", "--border-strong"] as const;
const CHART_TOKENS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--chart-7",
  "--chart-8",
] as const;

const TYPE_SCALE = [
  { cls: "type-display-lg", label: "display-lg · 32/38 · -0.022em · 700" },
  { cls: "type-display", label: "display · 28/34 · -0.02em · 700" },
  { cls: "type-h1", label: "h1 · 24/30 · -0.017em · 650" },
  { cls: "type-h2", label: "h2 · 20/26 · -0.014em · 600" },
  { cls: "type-h3", label: "h3 · 17/24 · -0.011em · 600" },
  { cls: "type-title", label: "title · 15/22 · -0.006em · 600" },
  { cls: "type-body-lg", label: "body-lg · 16/25 · 400" },
  { cls: "type-body", label: "body · 14/22 · 400" },
  { cls: "type-body-sm", label: "body-sm · 13/20 · 400" },
  { cls: "type-caption", label: "caption · 12/17 · 400" },
  { cls: "type-overline", label: "overline · 11/16 · +0.08em · 600 · uppercase" },
] as const;

const SPACING = [2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64];
const RADII = [
  { name: "sm", px: 6 },
  { name: "md", px: 10 },
  { name: "lg", px: 14 },
  { name: "xl", px: 20 },
  { name: "pill", px: 999 },
];

// Re-render when the html class (theme) flips; token values are then read
// fresh from computed styles during render. useSyncExternalStore keeps
// this hydration-safe (server snapshot = empty class) without
// setState-in-an-effect.
function subscribeToHtmlClass(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

const subscribeNever = () => () => {};

function useResolvedTokens(tokens: readonly string[]): Record<string, string> {
  const htmlClass = useSyncExternalStore(
    subscribeToHtmlClass,
    () => document.documentElement.className,
    () => ""
  );
  void htmlClass; // the value only matters as a re-render trigger
  // Hydration gate: server render and the hydration pass both see {} so
  // the markup matches; React re-renders once mounted and the real
  // computed values appear.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
  if (!hydrated) return {};
  const style = getComputedStyle(document.documentElement);
  const values: Record<string, string> = {};
  for (const token of tokens) values[token] = style.getPropertyValue(token).trim();
  return values;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="type-h2 text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({
  token,
  value,
  against,
}: {
  token: string;
  value: string;
  against?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-surface p-2 shadow-e1">
      <div
        className="size-10 shrink-0 rounded-md border border-border-subtle"
        style={{ background: value || undefined }}
      />
      <div className="min-w-0">
        <p className="truncate font-mono text-xs text-foreground">{token}</p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {value || "…"}
          {against && value ? ` · ${contrast(value, against)} vs text` : ""}
        </p>
      </div>
    </div>
  );
}

export function StyleguideView() {
  const all = useResolvedTokens([
    ...SURFACE_TOKENS,
    ...TEXT_TOKENS,
    ...BRAND_TOKENS,
    ...SEMANTIC_TOKENS,
    ...BORDER_TOKENS,
    ...CHART_TOKENS,
  ]);
  const ink = all["--foreground"] ?? "#1a1a18";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="type-overline text-muted-foreground">Design system</p>
          <h1 className="type-display text-foreground">Style guide</h1>
          <p className="type-body mt-1 text-text-secondary">
            The living source of truth — tokens, type, and every primitive
            with its states. Light is the default theme; try the toggle.
          </p>
        </div>
        <ThemeToggle />
      </div>

      <Section title="Surfaces & text">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SURFACE_TOKENS.map((t) => (
            <Swatch key={t} token={t} value={all[t] ?? ""} against={ink} />
          ))}
          {TEXT_TOKENS.map((t) => (
            <Swatch key={t} token={t} value={all[t] ?? ""} against={all["--surface"]} />
          ))}
        </div>
      </Section>

      <Section title="Brand — yellow is a seasoning">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {BRAND_TOKENS.map((t) => (
            <Swatch key={t} token={t} value={all[t] ?? ""} against="#171717" />
          ))}
        </div>
        <p className="type-body-sm text-muted-foreground">
          Reserved for: the one primary action per screen, the brand mark,
          focus rings, progress fills, and small active indicators. Text on
          yellow is always dark ink (#171717), never white.
        </p>
      </Section>

      <Section title="Semantic">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SEMANTIC_TOKENS.map((t) => (
            <Swatch key={t} token={t} value={all[t] ?? ""} against={all["--surface"]} />
          ))}
        </div>
        <p className="type-body-sm text-muted-foreground">
          Warning is hue-shifted orange so it never reads as brand yellow.
          Each hue ships a -subtle background and an -fg text variant.
        </p>
      </Section>

      <Section title="Borders & data-viz">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BORDER_TOKENS.map((t) => (
            <Swatch key={t} token={t} value={all[t] ?? ""} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {CHART_TOKENS.map((t) => (
            <div key={t} className="flex flex-col items-center gap-1">
              <div
                className="h-16 w-9 rounded-md"
                style={{ background: all[t] || undefined }}
              />
              <span className="font-mono text-[10px] text-muted-foreground">
                {t.replace("--chart-", "c")}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-e2">
          {TYPE_SCALE.map((t) => (
            <div key={t.cls} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
              <span className={`${t.cls} text-foreground`}>
                Racking installed right
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {t.label}
              </span>
            </div>
          ))}
          <div className="mt-2 border-t border-border-subtle pt-3">
            <p className="type-overline text-muted-foreground">Numeric style</p>
            <p className="num type-body mt-1 text-right text-foreground">
              3,742 <span className="text-muted-foreground">beams</span> ·
              12,480 <span className="text-muted-foreground">lbs</span> · 618.5{" "}
              <span className="text-muted-foreground">hrs</span>
            </p>
            <p className="type-caption mt-1 text-right text-muted-foreground">
              Right-aligned, tabular figures, thousands separators, muted unit
              suffixes.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Spacing · radius · elevation · motion">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface p-5 shadow-e2">
            <p className="type-overline mb-3 text-muted-foreground">
              Spacing (4px base)
            </p>
            <div className="flex flex-col gap-1.5">
              {SPACING.map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <span className="num w-8 text-right font-mono text-[11px] text-muted-foreground">
                    {s}
                  </span>
                  <div className="h-3 rounded-sm bg-brand" style={{ width: s }} />
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-border bg-surface p-5 shadow-e2">
              <p className="type-overline mb-3 text-muted-foreground">Radius</p>
              <div className="flex flex-wrap items-end gap-3">
                {RADII.map((r) => (
                  <div key={r.name} className="flex flex-col items-center gap-1">
                    <div
                      className="size-14 border border-border-strong bg-surface-sunken"
                      style={{ borderRadius: r.px }}
                    />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {r.name} {r.px === 999 ? "" : `${r.px}px`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-5 shadow-e2">
              <p className="type-overline mb-3 text-muted-foreground">
                Elevation (soft shadows carry depth on light)
              </p>
              <div className="flex flex-wrap gap-4">
                {[1, 2, 3, 4].map((e) => (
                  <div
                    key={e}
                    className={`flex size-16 items-center justify-center rounded-lg bg-surface text-xs text-muted-foreground shadow-e${e}`}
                  >
                    e-{e}
                  </div>
                ))}
              </div>
              <p className="type-overline mb-2 mt-5 text-muted-foreground">Motion</p>
              <div className="flex items-center gap-3">
                {(["fast", "base", "slow"] as const).map((speed) => (
                  <div
                    key={speed}
                    className="group relative flex h-9 w-24 cursor-pointer items-center rounded-md border border-border bg-surface-sunken px-1"
                  >
                    <div
                      className="size-6 rounded-sm bg-brand transition-transform group-hover:translate-x-14"
                      style={{
                        transitionDuration: `var(--duration-${speed})`,
                        transitionTimingFunction: "var(--easing-standard)",
                      }}
                    />
                    <span className="pointer-events-none absolute translate-x-8 font-mono text-[10px] text-muted-foreground">
                      {speed}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Component gallery (Phase 11)">
        <ComponentGallery />
      </Section>

      <Section title="Base primitives">
        <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 shadow-e2">
          <div>
            <p className="type-overline mb-2 text-muted-foreground">Buttons</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button>Primary — one per screen</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Danger</Button>
              <Button disabled>Disabled</Button>
            </div>
          </div>
          <div>
            <p className="type-overline mb-2 text-muted-foreground">Inputs</p>
            <div className="flex max-w-sm flex-col gap-2">
              <Input placeholder="Default input" />
              <Input placeholder="Disabled" disabled />
              <Input placeholder="Invalid" aria-invalid />
            </div>
          </div>
          <div>
            <p className="type-overline mb-2 text-muted-foreground">
              Focus ring (tab to see)
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground"
              >
                Keyboard-focus me
              </button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
