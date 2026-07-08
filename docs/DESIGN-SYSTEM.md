# Handy PM Design System

Phase 10 foundation. The living, rendered version is `/styleguide`
(office-gated) — this file is the written contract. Everything in the app
consumes these tokens; no stray hex/px in components.

## Principles

1. **Premium, calm, spacious.** Generous whitespace and clear hierarchy
   beat density-by-default. This is a professional tool people stare at
   all day. (Power grids get an opt-in compact density instead of making
   everything cramped.)
2. **Yellow is a seasoning, not the meal.** Handy Equip yellow (#f2c00e)
   is reserved for: the ONE primary action on a screen (occasionally two),
   the brand mark, focus/active accents, and progress fills. It must never
   flood nav pills, every button, or full-width bars. Neutral layered
   surfaces carry the UI; yellow points the eye at the thing that matters.
   On the light theme yellow pops even harder — use it more sparingly, and
   never white text on yellow (always ink `#171717`).
3. **Depth through layered neutrals + hairline borders + soft shadows**,
   not through color. Light theme: the off-white canvas (`--background`)
   sits under white cards (`--surface`) with `--elevation-*` shadows and
   `--border`/`--border-subtle` hairlines.
4. **Motion is quick and physical (120–220ms), never decorative.**
   `prefers-reduced-motion` collapses all animation.
5. **Every state designed**: default, hover, focus-visible, active,
   disabled, loading (skeleton), empty (headline + CTA), error.

## Themes

- **Light is the default and primary theme** — bright, spacious, premium.
- **Dark is a secondary opt-in** (`html.dark`, persisted at
  `localStorage["handy-pm:theme"]`, applied pre-paint by the root layout's
  inline script; toggled via `<ThemeToggle/>`). Same token names, warm
  charcoal values.
- **`.force-light`** re-applies the light set on a subtree regardless of
  the html class: the customer Portal (`app/portal/layout.tsx`) and print
  surfaces are always light.

## Token reference (`app/globals.css`)

### Surfaces (light values)
| Token | Value | Use |
|---|---|---|
| `--background` | `#F7F7F5` | App canvas — soft off-white so cards read against it |
| `--surface` / `--card` / `--popover` | `#FFFFFF` | Cards, panels, popovers (elevation differentiates) |
| `--surface-sunken` / `--muted` | `#F0F0EE` | Input wells, table headers, subdued blocks |
| `--stage` | `#E9E9E6` | Drawing-canvas stage (white drawing pops) |

### Text
`--foreground` `#1A1A18` (primary ink) · `--text-secondary` `#5A5A55` ·
`--muted-foreground` `#8A8A83` (muted) · disabled via opacity ·
`--primary-foreground` `#171717` (ink on yellow — never white).

### Brand
`--primary`/`--brand` `#f2c00e` · `--brand-hover` `#E4B408` ·
`--brand-pressed` `#CBA007` · `--brand-subtle` `#FAF3D7` (selected-row
wash, active-tab tint, progress track).

**Naming decision (ADR-048):** shadcn's `--accent` is the *neutral hover
wash* every existing component consumes (`hover:bg-accent`), so brand
yellow lives on `--primary`/`--brand` and `--accent` stays neutral
(`#F0F0EE` light / `#2A2A28` dark). Redefining `accent` to yellow would
have turned every hover state yellow — the exact disease this system
kills.

### Semantic (each with `-subtle` bg + `-fg` text)
`--success` `#16A34A` · `--warning` `#D97706` (hue-shifted orange —
deliberately distinct from brand yellow) · `--destructive` `#DC2626` ·
`--info` `#2563EB`.

### Borders & focus
`--border-subtle` `#ECECEA` · `--border` `#E2E2DF` · `--border-strong`
`#CFCFCB` · focus ring = global `:focus-visible` 2px `--ring` (yellow)
with 2px offset, keyboard-only.

### Data-viz
`--chart-1..8`: blue, green, orange, purple, teal, pink, slate, brown —
tuned for white; dark theme swaps lighter variants. Progress fills:
yellow → green at 100%.

### Spacing, radius, elevation, motion
- Spacing: 4px base — 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radius: sm 6 / md 10 / lg 14 / xl 20 / pill.
- Elevation: `shadow-e1..e4` (`--elevation-1..4`) — soft, low-spread; the
  main depth source on light. e-0 flat · e-1 hairline+faint · e-2 cards ·
  e-3 popovers/sheets · e-4 modals.
- Motion: `--duration-fast` 120ms / `--duration-base` 180ms /
  `--duration-slow` 220ms; `--easing-standard`, `--easing-emphasized`.

## Typography

Geist (UI/body, `next/font`, self-hosted, zero layout shift) + Geist Mono
(code/ids). Tabular figures for all tables/stats/money via `.num` or
Tailwind `tabular-nums`.

Modular scale (class → size/line/tracking/weight):
`type-display-lg` 32/38 −0.022em 700 · `type-display` 28/34 −0.02em 700 ·
`type-h1` 24/30 −0.017em 650 · `type-h2` 20/26 −0.014em 600 · `type-h3`
17/24 −0.011em 600 · `type-title` 15/22 −0.006em 600 · `type-body-lg`
16/25 · `type-body` 14/22 · `type-body-sm` 13/20 · `type-caption` 12/17 ·
`type-overline` 11/16 +0.08em 600 uppercase (section labels).

Numeric style: right-align quantities; tabular figures; thousands
separators; unit suffixes as muted text.

## Density & layout

- Reading views max-width ~`max-w-4xl`; data/grid views up to
  `max-w-screen-2xl`.
- 8pt vertical rhythm between blocks; generous section gaps (24–40px).
- Density: `[data-density="comfortable"]` (default) /
  `[data-density="compact"]` switch `--grid-pad-y/x` consumed by the
  DataGrid (Phase 11).
- Breakpoints: Tailwind defaults; `/field` and the portal are designed
  mobile-first.

## Component rules (Phase 11 builds on these)

- **One primary (yellow) button per view.** Everything else: secondary
  (neutral raised), outline, ghost, danger.
- Badges/pills: `-subtle` background + `-fg` text, never solid slabs.
- Tabs: underline + `brand-subtle` tint on the active item — no yellow
  slabs.
- Tables: sticky header, hairline row separators (no zebra), right-aligned
  tabular numerics, `--grid-pad-*` density.
- Touch targets ≥44px on field/mobile surfaces.

## Component inventory (Phase 11)

All in `components/ui/` unless noted; every one demoed live on
`/styleguide`.

| Component | Source | Notes |
| --- | --- | --- |
| `Button` | registry, refined | brand hover/pressed ramps; `loading`; `destructive-solid`; `field`/`icon-field` = 44px |
| `Input`, `Textarea`, `Label` | registry | native `type="date"` is the date picker (OS sheet on phones) |
| `Combobox*`, `InputGroup*` | registry | searchable select on Base UI Combobox |
| `Select*`, `Checkbox`, `Switch` | registry | |
| `NumberStepper` | hand-built | Base UI number-field; −/+ hold-to-repeat; `size="field"` |
| `Tabs*`, `Breadcrumb*`, `Card*` | registry | |
| `Dialog*`, `Sheet*`, `Popover*`, `Tooltip*`, `DropdownMenu*` | registry | |
| `ConfirmDialog` | hand-built | destructive preset; async `onConfirm` pending state |
| `Toaster` (sonner) | registry, refined | reads our `html.dark`, not next-themes; mounted in root layout |
| `FileDropzone` | hand-built | drag/drop over a real `<input type=file>` (camera sheet on mobile) |
| `DataGrid` | hand-built | sticky header + first col, sort, column groups, show/hide, density |
| `PageHeader`/`SectionHeader`, `StatTile`, `Sparkline` | hand-built | |
| `ProgressBar`/`ProgressRing`, `StatusPill`, `Segmented`/`SegmentedMulti` | hand-built | |
| `EmptyState`/`ErrorState`/`Skeleton*` | hand-built | |
| `Toolbar*` | hand-built | canvas chrome (Layout stage) |
| `AppShell` | `components/app-shell.tsx` | desktop sidebar; mobile top bar + bottom tabs + More sheet |
| `ThemeToggle` | `components/theme-toggle.tsx` | persists `handy-pm:theme` |
