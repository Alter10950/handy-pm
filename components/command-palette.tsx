"use client";

import {
  CalculatorIcon,
  CalendarDaysIcon,
  FolderKanbanIcon,
  HardHatIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  UserCircleIcon,
  UsersIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { searchProjects, type ProjectSearchHit } from "@/lib/search/actions";
import type { ProfileRole } from "@/lib/supabase/database.types";

// ⌘K / Ctrl-K global jump (Phase 16): nav destinations + live project
// search. Project results are fetched debounced through a server action
// (RLS-scoped) — the palette opens instantly with nav items and fills in
// projects as you type.
export function CommandPalette({ role }: { role: ProfileRole | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProjectSearchHit[]>([]);
  const requestSeq = useRef(0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeq.current;
    const handle = setTimeout(() => {
      searchProjects(query)
        .then((results) => {
          if (requestSeq.current === seq) setHits(results);
        })
        .catch(() => {
          if (requestSeq.current === seq) setHits([]);
        });
    }, 150);
    return () => clearTimeout(handle);
  }, [open, query]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  const office = role === "owner" || role === "pm" || role === "scheduler";
  const admin = role === "owner" || role === "pm";

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Jump to"
      description="Search projects and destinations"
    >
      <Command>
        <CommandInput
          placeholder="Search projects, or jump anywhere…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>Nothing matches.</CommandEmpty>
          {hits.length > 0 ? (
            <CommandGroup heading="Projects">
              {hits.map((hit) => (
                <CommandItem
                  key={hit.id}
                  value={`${hit.name} ${hit.id}`}
                  onSelect={() => go(`/app/project/${hit.id}`)}
                >
                  <FolderKanbanIcon aria-hidden />
                  <span className="truncate">{hit.name}</span>
                  <span className="ml-auto text-xs capitalize text-muted-foreground">
                    {hit.status}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          <CommandSeparator />
          <CommandGroup heading="Go to">
            <CommandItem value="Projects" onSelect={() => go("/app")}>
              <FolderKanbanIcon aria-hidden /> Projects
            </CommandItem>
            {office ? (
              <CommandItem
                value="Dashboard"
                onSelect={() => go("/app/dashboard")}
              >
                <LayoutDashboardIcon aria-hidden /> Dashboard
              </CommandItem>
            ) : null}
            <CommandItem value="Field" onSelect={() => go("/field")}>
              <HardHatIcon aria-hidden /> Field
            </CommandItem>
            {office ? (
              <>
                <CommandItem
                  value="Scheduler"
                  onSelect={() => go("/scheduler")}
                >
                  <CalendarDaysIcon aria-hidden /> Scheduler
                </CommandItem>
                <CommandItem
                  value="Estimating"
                  onSelect={() => go("/app/estimate")}
                >
                  <CalculatorIcon aria-hidden /> Estimating
                </CommandItem>
              </>
            ) : null}
            {admin ? (
              <>
                <CommandItem value="Team" onSelect={() => go("/app/team")}>
                  <UsersIcon aria-hidden /> Team
                </CommandItem>
                <CommandItem
                  value="Settings"
                  onSelect={() => go("/app/settings")}
                >
                  <SettingsIcon aria-hidden /> Settings
                </CommandItem>
              </>
            ) : null}
            <CommandItem value="Account" onSelect={() => go("/account")}>
              <UserCircleIcon aria-hidden /> Account
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
