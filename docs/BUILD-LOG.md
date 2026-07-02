# Build log

Engineering journal. Newest entries at top.

---

## 2026-07-02 — Phase 1: foundation, auth, theme, PWA

**What:** Stood up the whole Phase 1 foundation in one session: docs system,
Next.js scaffold, Supabase auth, Handy Equip theme, app shell, PWA, README.

**Scaffold:** `create-next-app` refuses project names with capitals/spaces
(the working directory is `Handy PM`), so it was scaffolded into a temp
`handy-pm-tmp` subfolder and moved up into the repo root, with `package.json`
`name` fixed to `handy-pm` afterward. Removed the auto-generated
`CLAUDE.md`/`AGENTS.md` scaffold files (replaced with the real ones), the
default `/next.svg` etc. placeholder assets, and the default homepage.

**Theme:** `npx shadcn@latest init -d` resolved to the `base-nova` preset
(Base UI, not Radix) — kept it rather than forcing the older Radix-based
style; see ADR-003. Replaced the generated neutral/oklch light+dark token
pairs in `app/globals.css` with the Handy Equip palette as a single fixed
dark theme (ADR-004). Fixed a bug in the generated `globals.css`/
`layout.tsx` pair where `--font-sans` was self-referential (the Geist font
variable was named `--font-geist-sans` but the theme expected `--font-sans`)
by renaming the font variable.

**Auth:** Wired `@supabase/supabase-js` + `@supabase/ssr` with three client
factories (`lib/supabase/{client,server,admin}.ts`) plus a lazy env-var
reader. The tricky part was making `npm run build` pass with **no** Supabase
project configured yet — `@supabase/ssr`'s client constructor throws
synchronously on a missing/empty URL, and Next.js will execute a page's
render function during its build-time static-generation attempt unless the
route is forced dynamic. Solved by (a) never constructing a Supabase client
at module scope, (b) only calling the browser client from inside event
handlers, and (c) marking every server-side consumer `force-dynamic`. See
ADR-006 for the full reasoning. Verified by smoke-testing the dev server
with placeholder (syntactically valid, non-functional) env values: `/`
redirects unauthenticated requests to `/login` (307), `/app` and
`/scheduler` redirect with a `?next=` param, `/login` and `/portal/[token]`
render 200 without needing any Supabase call. Full magic-link delivery
wasn't tested — that needs a real Supabase project, which doesn't exist yet.

**Routing:** Built `/app`, `/scheduler`, `/field` inside an
`app/(protected)/` route group sharing one layout that checks auth and
renders the header/nav; `/portal/[token]` and `/login` sit outside it,
public. Discovered along the way that putting `/field` in the same route
group as `/app`/`/scheduler` means the shared layout guards it too, even
though the brief only explicitly required guarding `/app` and `/scheduler` —
decided to keep that behavior (crew accounts should need sign-in) and made
`proxy.ts`'s explicit prefix list match it for consistency. See ADR-007.

**Next.js 16 surprise:** the `middleware.ts` file convention is deprecated
in Next 16 in favor of `proxy.ts` (exported function renamed `proxy`). The
first build surfaced this as a deprecation warning; renamed the file (and
the internal `lib/supabase/middleware.ts` helper, for naming consistency)
before it became a real problem.

**PWA:** Icons (favicon, apple-touch-icon, 192/512/512-maskable) are
generated at build time via `next/og`'s `ImageResponse` special-file
conventions rather than checked-in binary placeholders — a yellow square
with a dark "HP" wordmark. Initially set `runtime = "edge"` on the icon
route handlers (copied from an old habit); build warned that edge runtime
disables static generation, and since these routes have no per-request
variance, removed the edge runtime and added `export const dynamic =
"force-static"` instead so they're prerendered once, not regenerated per
request. Service worker is hand-rolled (network-first, cached app-shell
fallback) rather than Serwist/next-pwa, to avoid unverified compatibility
risk with a same-day Next 16/React 19/Turbopack stack — see ADR-002.

**Problems fixed:**

- `create-next-app` naming restriction (see Scaffold above).
- `shadcn init -b neutral` isn't a valid `--base` value — that flag selects
  the component library (`radix`/`base`), not the color; used `-d` instead.
- `.gitignore`'s default `.env*` pattern would have also ignored
  `.env.local.example`; added a `!.env.local.example` negation.
- `next build` initially warned about the deprecated `middleware` convention
  and about edge runtime disabling static generation — both fixed as
  described above.

**Quality gates:** `npm run lint`, `npm run typecheck`, and `npm run build`
all pass clean (see the final commit for output). `npm run format` applied
project-wide.

**Left for the user:** create a Supabase project, fill in
`.env.local` from `.env.local.example`, add the same three env vars to
Vercel, and confirm the Phase 2 roadmap draft in `docs/PROGRESS.md` before
that phase starts.
