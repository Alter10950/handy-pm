"use client";

import {
  CalculatorIcon,
  CalendarDaysIcon,
  FolderKanbanIcon,
  HardHatIcon,
  LayoutDashboardIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  UserCircleIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { signOut } from "@/lib/auth/actions";
import type { NotificationRow } from "@/lib/notifications/shared";
import type { ProfileRole } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

// The authed application frame (Phase 11/12): fixed sidebar on desktop,
// top bar + bottom tab bar on mobile (44px+ targets, safe-area padded).
// Yellow is seasoning here — active nav is a raised neutral chip with a
// brand accent bar, never a yellow slab.

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const OFFICE_ROLES: (ProfileRole | null)[] = ["owner", "pm", "scheduler"];
const ADMIN_ROLES: (ProfileRole | null)[] = ["owner", "pm"];

function navSections(
  role: ProfileRole | null
): { label: string | null; items: NavItem[] }[] {
  const office = OFFICE_ROLES.includes(role);
  const admin = ADMIN_ROLES.includes(role);
  return [
    {
      label: null,
      items: [
        { href: "/app", label: "Projects", icon: FolderKanbanIcon },
        ...(office
          ? [
              {
                href: "/app/dashboard",
                label: "Dashboard",
                icon: LayoutDashboardIcon,
              },
            ]
          : []),
        { href: "/field", label: "Field", icon: HardHatIcon },
        ...(office
          ? [
              {
                href: "/scheduler",
                label: "Scheduler",
                icon: CalendarDaysIcon,
              },
              {
                href: "/app/estimate",
                label: "Estimating",
                icon: CalculatorIcon,
              },
            ]
          : []),
      ],
    },
    ...(admin
      ? [
          {
            label: "Workspace",
            items: [
              { href: "/app/team", label: "Team", icon: UsersIcon },
              { href: "/app/settings", label: "Settings", icon: SettingsIcon },
            ],
          },
        ]
      : []),
  ];
}

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/app") {
    // "/app" is both the Projects list and the /app/* namespace root —
    // only exact (or project detail) counts, not /app/team etc.
    return pathname === "/app" || pathname.startsWith("/app/project/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function BrandMark() {
  return (
    <Link
      href="/app"
      className="flex items-center gap-2"
      aria-label="HandyPM home"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-sm font-black text-primary-foreground shadow-e1">
        H
      </span>
      <span className="text-base font-bold tracking-tight text-foreground">
        Handy<span className="text-text-secondary">PM</span>
      </span>
    </Link>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-surface text-foreground shadow-e1"
          : "text-text-secondary hover:bg-accent hover:text-foreground"
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brand"
        />
      ) : null}
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export function AppShell({
  userEmail,
  role,
  notifications,
  children,
}: {
  userEmail: string;
  role: ProfileRole | null;
  notifications: NotificationRow[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const sections = navSections(role);

  // Mobile bottom bar: first four primary items; the sheet carries the
  // full nav plus Account.
  const allItems = sections.flatMap((s) => s.items);
  const tabItems = allItems.slice(0, 4);

  return (
    <div className="flex min-h-full flex-1">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-e3"
      >
        Skip to content
      </a>
      <CommandPalette role={role} />

      {/* ── Desktop sidebar ── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border-subtle bg-surface-sunken/60 lg:flex">
        <div className="flex h-14 items-center px-4">
          <BrandMark />
        </div>
        <nav
          aria-label="Main"
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-2"
        >
          {sections.map((section, i) => (
            <div key={i} className="flex flex-col gap-0.5">
              {section.label ? (
                <div className="type-overline px-2.5 pb-1 text-muted-foreground">
                  {section.label}
                </div>
              ) : null}
              {section.items.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  active={isActivePath(pathname, item.href)}
                />
              ))}
            </div>
          ))}
        </nav>
        <div className="flex flex-col gap-2 border-t border-border-subtle p-3">
          <Link
            href="/account"
            aria-current={pathname === "/account" ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
              pathname === "/account"
                ? "bg-surface shadow-e1"
                : "hover:bg-accent"
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-xs font-semibold uppercase text-foreground shadow-e1">
              {userEmail.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                {userEmail}
              </span>
              {role ? (
                <span className="block text-[11px] capitalize text-muted-foreground">
                  {role}
                </span>
              ) : null}
            </span>
          </Link>
          <div className="flex items-center justify-between gap-2 px-1">
            <ThemeToggle />
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border-subtle bg-background/90 px-4 backdrop-blur lg:hidden">
          <BrandMark />
          <div className="flex items-center gap-1">
            <NotificationBell notifications={notifications} />
            <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger
                aria-label="Menu"
                className="grid size-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <MenuIcon aria-hidden className="size-5" />
              </SheetTrigger>
              <SheetContent
                side="right"
                className="flex w-72 flex-col gap-0 p-0"
              >
                <SheetHeader className="border-b border-border-subtle px-4 py-3">
                  <SheetTitle className="text-left text-sm">
                    <span className="block truncate font-medium text-foreground">
                      {userEmail}
                    </span>
                    {role ? (
                      <span className="block text-xs font-normal capitalize text-muted-foreground">
                        {role}
                      </span>
                    ) : null}
                  </SheetTitle>
                </SheetHeader>
                <nav
                  aria-label="More"
                  className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3"
                >
                  {[
                    ...allItems,
                    {
                      href: "/account",
                      label: "Account",
                      icon: UserCircleIcon,
                    },
                  ].map((item) => {
                    const Icon = item.icon;
                    const active = isActivePath(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        onClick={() => setMoreOpen(false)}
                        className={cn(
                          "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                          active
                            ? "bg-surface text-foreground shadow-e1"
                            : "text-text-secondary hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <Icon aria-hidden className="size-4.5 shrink-0" />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
                <div className="flex items-center justify-between gap-2 border-t border-border-subtle p-3">
                  <ThemeToggle />
                  <form action={signOut}>
                    <Button type="submit" variant="outline" size="sm">
                      Sign out
                    </Button>
                  </form>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        {/* Desktop top-right utilities */}
        <div className="sticky top-0 z-20 hidden h-14 items-center justify-end gap-2 border-b border-border-subtle bg-background/90 px-6 backdrop-blur lg:flex">
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", metaKey: true })
              )
            }
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-muted-foreground shadow-e1 transition-colors hover:text-foreground"
          >
            <SearchIcon aria-hidden className="size-3.5" />
            Search…
            <kbd className="rounded border border-border bg-surface-sunken px-1.5 font-mono text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </button>
          <NotificationBell notifications={notifications} />
        </div>

        <main
          id="main-content"
          className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 pb-24 pt-6 lg:px-8 lg:pb-10"
        >
          {children}
        </main>

        {/* ── Mobile bottom tab bar ── */}
        <nav
          aria-label="Quick"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-surface/95 backdrop-blur lg:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="grid auto-cols-fr grid-flow-col">
            {tabItems.map((item) => {
              const Icon = item.icon;
              const active = isActivePath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-[52px] flex-col items-center justify-center gap-0.5 px-1 pt-1.5 pb-1 text-[11px] font-medium transition-colors",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "grid h-6 w-12 place-items-center rounded-full transition-colors",
                      active ? "bg-brand-subtle" : ""
                    )}
                  >
                    <Icon aria-hidden className="size-4.5" />
                  </span>
                  {item.label}
                </Link>
              );
            })}
            <button
              type="button"
              aria-label="More"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)}
              className="flex min-h-[52px] flex-col items-center justify-center gap-0.5 px-1 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground transition-colors"
            >
              <span className="grid h-6 w-12 place-items-center rounded-full">
                <MenuIcon aria-hidden className="size-4.5" />
              </span>
              More
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
