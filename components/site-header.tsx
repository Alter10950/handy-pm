"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";
import type { ProfileRole } from "@/lib/supabase/database.types";

const BASE_NAV_LINKS = [
  { href: "/app", label: "Projects" },
  { href: "/field", label: "Field" },
];

export function SiteHeader({
  userEmail,
  role,
}: {
  userEmail: string;
  role: ProfileRole | null;
}) {
  const pathname = usePathname();
  // Scheduler is an office tool — matches the page-level redirect guard on
  // /scheduler and /scheduler/[projectId] (crew's equivalent is Field).
  const navLinks = [
    ...BASE_NAV_LINKS,
    ...(role === "owner" || role === "pm" || role === "scheduler"
      ? [
          { href: "/scheduler", label: "Scheduler" },
          { href: "/app/estimate", label: "Estimating" },
        ]
      : []),
    ...(role === "owner" || role === "pm"
      ? [
          { href: "/app/team", label: "Team" },
          { href: "/app/settings", label: "Settings" },
        ]
      : []),
  ];

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/app"
          className="text-xl font-bold tracking-tight text-foreground"
        >
          Handy<span className="text-primary">PM</span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {navLinks.map((link) => {
            const isActive =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex h-11 items-center rounded-md px-4 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden max-w-40 truncate text-sm text-muted-foreground sm:inline">
            {userEmail}
          </span>
          <Link
            href="/account"
            className={cn(
              "text-sm font-medium transition-colors hover:text-foreground",
              pathname === "/account"
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            Account
          </Link>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="default">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
