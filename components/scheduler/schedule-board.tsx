"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { sendFinishChangedNotice } from "@/lib/comms/actions";
import { addDays } from "@/lib/dates";
import {
  autoPlanProjectBar,
  writeProjectBar,
} from "@/lib/scheduler/board-actions";
import {
  type BoardAssignment,
  type ProjectBar,
  barsFromAssignments,
  diffDays,
  enumerateDays,
  fillWorkingDays,
  findBoardConflicts,
  moveBarDates,
  resizeBarDates,
  snapToWorkingDay,
  stackBars,
} from "@/lib/scheduler/board";
import type {
  BoardBlocker,
  BoardProjectMeta,
  OrgAssignment,
  OrgScheduleDay,
} from "@/lib/scheduler/queries";
import type { Tables } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

// THE scheduler (design pass v3 F1): a drag-drop board — project bars on
// crew swimlanes. Drag a bar to move it, grab an edge to resize its
// duration, drag across lanes to reassign the crew, paint individual days
// off, drop unscheduled projects from the tray, auto-plan from the
// estimate. Conflicts (double-booked crew, org capacity per ADR-044)
// highlight live while dragging; capacity is a hard stop, double-booking
// is a confirm — matching the existing calendar's semantics.

const PROJECT_DATA_TYPE = "application/x-handy-pm-project";

type Zoom = "week" | "month" | "quarter";
const ZOOM: Record<Zoom, { days: number; dayWidth: number }> = {
  week: { days: 14, dayWidth: 88 },
  month: { days: 35, dayWidth: 36 },
  quarter: { days: 91, dayWidth: 15 },
};

const BAR_H = 36;
const TRACK_GAP = 4;
const LANE_PAD = 8;
const PARTIAL_H = 6;

// Per-project bar palette — soft tint + strong edge + ink text, light-first
// with dark-mode variants (same stable-hash idea as the calendar's chips).
const BAR_COLORS = [
  "border-l-amber-500 bg-amber-100 text-amber-950 dark:bg-amber-500/20 dark:text-amber-100",
  "border-l-sky-500 bg-sky-100 text-sky-950 dark:bg-sky-500/20 dark:text-sky-100",
  "border-l-violet-500 bg-violet-100 text-violet-950 dark:bg-violet-500/20 dark:text-violet-100",
  "border-l-emerald-500 bg-emerald-100 text-emerald-950 dark:bg-emerald-500/20 dark:text-emerald-100",
  "border-l-rose-500 bg-rose-100 text-rose-950 dark:bg-rose-500/20 dark:text-rose-100",
  "border-l-orange-500 bg-orange-100 text-orange-950 dark:bg-orange-500/20 dark:text-orange-100",
];
function colorForProject(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i += 1) {
    hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  }
  return BAR_COLORS[hash % BAR_COLORS.length];
}

function formatShort(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")
  ).toUpperCase();
}

interface DragState {
  kind: "move" | "resize-start" | "resize-end";
  bar: ProjectBar;
  projectName: string;
  grabOffsetDays: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  candCrewId: string;
  candDates: string[];
  laneClash: string[];
  overCapacity: string[];
}

export function ScheduleBoard({
  crews,
  members,
  projects,
  assignments,
  schedule,
  blockers,
  numCrews,
  workingDays,
  today,
  windowStart,
}: {
  crews: Tables<"crews">[];
  members: Tables<"crew_members">[];
  projects: BoardProjectMeta[];
  assignments: OrgAssignment[];
  schedule: OrgScheduleDay[];
  blockers: BoardBlocker[];
  numCrews: number;
  workingDays: number[];
  today: string;
  windowStart: string;
}) {
  const router = useRouter();
  const [zoom, setZoom] = useState<Zoom>("week");
  const [paintMode, setPaintMode] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [notifyDraft, setNotifyDraft] = useState<{
    projectId: string;
    projectName: string;
    oldFinish: string | null;
    newFinish: string;
  } | null>(null);

  // Optimistic overlay: applied instantly on commit, ignored automatically
  // once fresh server props land (base identity changes on refresh).
  const [override, setOverride] = useState<{
    base: OrgAssignment[];
    next: OrgAssignment[];
  } | null>(null);
  const effectiveAssignments =
    override && override.base === assignments ? override.next : assignments;

  const headerDaysRef = useRef<HTMLDivElement | null>(null);
  const laneRefs = useRef(new Map<string, HTMLDivElement>());

  const { days: dayCount, dayWidth } = ZOOM[zoom];
  const days = useMemo(
    () => enumerateDays(windowStart, addDays(windowStart, dayCount - 1)),
    [windowStart, dayCount]
  );
  const workingSet = useMemo(() => new Set(workingDays), [workingDays]);

  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );
  const membersByCrew = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of members) {
      const list = map.get(m.crew_id) ?? [];
      list.push(m.name);
      map.set(m.crew_id, list);
    }
    return map;
  }, [members]);

  const boardAssignments: BoardAssignment[] = useMemo(
    () =>
      effectiveAssignments.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        crewId: a.crewId,
        rowId: a.rowId,
        workDate: a.workDate,
      })),
    [effectiveAssignments]
  );

  const bars = useMemo(
    () => barsFromAssignments(boardAssignments),
    [boardAssignments]
  );
  const barsByCrew = useMemo(() => {
    const map = new Map<string, ProjectBar[]>();
    for (const bar of bars) {
      const list = map.get(bar.crewId) ?? [];
      list.push(bar);
      map.set(bar.crewId, list);
    }
    return map;
  }, [bars]);

  // Row/phase-scoped assignments render as slim non-draggable strips —
  // they're N underlying rows, not a whole-project bar (see actions.ts).
  const partialsByCrew = useMemo(() => {
    const byKey = new Map<string, { projectId: string; dates: string[] }>();
    for (const a of boardAssignments) {
      if (a.rowId === null) continue;
      const key = `${a.projectId}:${a.crewId}`;
      const entry = byKey.get(key) ?? { projectId: a.projectId, dates: [] };
      entry.dates.push(a.workDate);
      byKey.set(key, entry);
    }
    const map = new Map<
      string,
      { projectId: string; start: string; end: string }[]
    >();
    for (const [key, entry] of byKey) {
      const crewId = key.split(":")[1];
      const dates = [...new Set(entry.dates)].sort();
      const list = map.get(crewId) ?? [];
      list.push({
        projectId: entry.projectId,
        start: dates[0],
        end: dates[dates.length - 1],
      });
      map.set(crewId, list);
    }
    return map;
  }, [boardAssignments]);

  const scheduledProjectsByDate = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of schedule) {
      const set = map.get(s.workDate) ?? new Set<string>();
      set.add(s.projectId);
      map.set(s.workDate, set);
    }
    return map;
  }, [schedule]);

  const blockersByProjectDate = useMemo(() => {
    const map = new Map<string, BoardBlocker[]>();
    for (const b of blockers) {
      const key = `${b.projectId}:${b.workDate}`;
      const list = map.get(key) ?? [];
      list.push(b);
      map.set(key, list);
    }
    return map;
  }, [blockers]);

  const unscheduled = useMemo(() => {
    const assigned = new Set(
      boardAssignments.filter((a) => a.rowId === null).map((a) => a.projectId)
    );
    return projects.filter((p) => !assigned.has(p.id));
  }, [projects, boardAssignments]);

  // ── geometry helpers ──
  function dateIndexAt(clientX: number): number {
    const rect = headerDaysRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(
      days.length - 1,
      Math.max(0, Math.floor((clientX - rect.left) / dayWidth))
    );
  }
  function crewIdAt(clientY: number): string | null {
    let best: string | null = null;
    let bestDist = Infinity;
    for (const [crewId, el] of laneRefs.current) {
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) return crewId;
      const dist = Math.min(
        Math.abs(clientY - rect.top),
        Math.abs(clientY - rect.bottom)
      );
      if (dist < bestDist) {
        bestDist = dist;
        best = crewId;
      }
    }
    return best;
  }

  // ── commit path (shared by drag, tray drop, paint, auto-plan) ──
  async function commitBar(input: {
    projectId: string;
    projectName: string;
    crewId: string;
    dates: string[];
    fromCrewId?: string;
    oldEnd: string | null;
  }) {
    // Optimistic: replace the touched bars locally right away.
    const next = effectiveAssignments.filter(
      (a) =>
        !(
          a.projectId === input.projectId &&
          a.rowId === null &&
          (a.crewId === input.crewId || a.crewId === input.fromCrewId)
        )
    );
    const crewName = crews.find((c) => c.id === input.crewId)?.name ?? "";
    for (const date of input.dates) {
      next.push({
        id: `optimistic:${input.projectId}:${date}`,
        projectId: input.projectId,
        projectName: input.projectName,
        crewId: input.crewId,
        crewName,
        rowId: null,
        workDate: date,
      });
    }
    setOverride({ base: assignments, next });
    setBusy(true);
    try {
      const result = await writeProjectBar({
        projectId: input.projectId,
        crewId: input.crewId,
        dates: input.dates,
        fromCrewId:
          input.fromCrewId && input.fromCrewId !== input.crewId
            ? input.fromCrewId
            : undefined,
      });
      if (!result.ok) {
        setOverride(null);
        toast.error(
          `Over capacity — the org has ${result.numCrews} crew${result.numCrews === 1 ? "" : "s"}, and ${result.overCapacity.length} of those day${result.overCapacity.length === 1 ? "s are" : " is"} already full. Move it or free those days first.`
        );
        return;
      }
      const newFinish = result.end;
      if (newFinish && input.oldEnd !== newFinish) {
        toast.success(
          `${input.projectName} → ${formatShort(result.start!)}–${formatShort(newFinish)}`,
          {
            action: {
              label: "Notify customer",
              onClick: () =>
                setNotifyDraft({
                  projectId: input.projectId,
                  projectName: input.projectName,
                  oldFinish: input.oldEnd,
                  newFinish,
                }),
            },
          }
        );
      }
      router.refresh();
    } catch (err) {
      setOverride(null);
      toast.error(
        err instanceof Error ? err.message : "Could not update the schedule."
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmClashes(crewId: string, clashDates: string[]): boolean {
    if (clashDates.length === 0) return true;
    const crewName = crews.find((c) => c.id === crewId)?.name ?? "This crew";
    return window.confirm(
      `${crewName} already has another project on ${clashDates.length} of those day${clashDates.length === 1 ? "" : "s"} (${clashDates
        .slice(0, 3)
        .map(formatShort)
        .join(", ")}${clashDates.length > 3 ? "…" : ""}). Double-book them?`
    );
  }

  // ── bar drag (pointer events) ──
  function beginDrag(
    event: React.PointerEvent,
    bar: ProjectBar,
    kind: DragState["kind"]
  ) {
    if (busy || event.button !== 0) return;
    if (paintMode && kind === "move") {
      // Paint mode: a press toggles the day under the cursor on/off.
      const date = days[dateIndexAt(event.clientX)];
      if (date < bar.start || date > bar.end) return;
      const has = bar.dates.includes(date);
      const nextDates = has
        ? bar.dates.filter((d) => d !== date)
        : [...bar.dates, date].sort();
      if (nextDates.length === 0) return; // never paint a bar away entirely
      const meta = projectById.get(bar.projectId);
      void commitBar({
        projectId: bar.projectId,
        projectName: meta?.name ?? "Project",
        crewId: bar.crewId,
        dates: nextDates,
        oldEnd: bar.end,
      });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const startIndex = dateIndexAt(event.clientX);
    const meta = projectById.get(bar.projectId);
    setDrag({
      kind,
      bar,
      projectName: meta?.name ?? "Project",
      grabOffsetDays: Math.max(
        0,
        startIndex - diffDays(windowStart, bar.start)
      ),
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
      candCrewId: bar.crewId,
      candDates: bar.dates,
      laneClash: [],
      overCapacity: [],
    });
  }

  function updateDrag(event: React.PointerEvent) {
    if (!drag) return;
    const moved =
      drag.moved ||
      Math.abs(event.clientX - drag.startClientX) > 4 ||
      Math.abs(event.clientY - drag.startClientY) > 4;
    const index = dateIndexAt(event.clientX);
    const date = days[index];
    let candDates = drag.candDates;
    let candCrewId = drag.candCrewId;
    if (drag.kind === "move") {
      const startIndex = Math.max(0, index - drag.grabOffsetDays);
      candDates = moveBarDates(drag.bar, days[startIndex], workingSet);
      candCrewId = crewIdAt(event.clientY) ?? drag.bar.crewId;
    } else {
      candDates = resizeBarDates(
        drag.bar,
        drag.kind === "resize-start" ? "start" : "end",
        date,
        workingSet
      );
    }
    const conflicts = findBoardConflicts({
      projectId: drag.bar.projectId,
      crewId: candCrewId,
      dates: candDates,
      assignments: boardAssignments,
      scheduledProjectsByDate,
      numCrews,
      exclude: { projectId: drag.bar.projectId, crewId: drag.bar.crewId },
    });
    setDrag({
      ...drag,
      moved,
      candDates,
      candCrewId,
      laneClash: conflicts.laneClash,
      overCapacity: conflicts.overCapacity,
    });
  }

  function endDrag() {
    if (!drag) return;
    const current = drag;
    setDrag(null);
    if (!current.moved) return;
    const unchanged =
      current.candCrewId === current.bar.crewId &&
      current.candDates.join() === current.bar.dates.join();
    if (unchanged) return;
    if (current.overCapacity.length > 0) {
      toast.error(
        `Can't place it there — ${current.overCapacity.length} day${current.overCapacity.length === 1 ? " is" : "s are"} already at the ${numCrews}-crew limit.`
      );
      return;
    }
    if (!confirmClashes(current.candCrewId, current.laneClash)) return;
    void commitBar({
      projectId: current.bar.projectId,
      projectName: current.projectName,
      crewId: current.candCrewId,
      dates: current.candDates,
      fromCrewId: current.bar.crewId,
      oldEnd: current.bar.end,
    });
  }

  // ── tray drop (HTML5 DnD onto day cells) ──
  async function handleCellDrop(
    event: React.DragEvent,
    crewId: string,
    date: string
  ) {
    event.preventDefault();
    setDropTarget(null);
    const projectId = event.dataTransfer.getData(PROJECT_DATA_TYPE);
    if (!projectId) return;
    // Let the drop event finish dispatching before any window.confirm —
    // a synchronous confirm inside the dispatch blocks the drag source's
    // dragend (and deadlocks automation drivers waiting on it).
    await new Promise((resolve) => setTimeout(resolve, 0));
    const meta = projectById.get(projectId);
    const span = Math.max(1, Math.ceil(meta?.plannedDays ?? 1));
    const dates = fillWorkingDays(
      snapToWorkingDay(date, workingSet),
      span,
      workingSet
    );
    const conflicts = findBoardConflicts({
      projectId,
      crewId,
      dates,
      assignments: boardAssignments,
      scheduledProjectsByDate,
      numCrews,
    });
    if (conflicts.overCapacity.length > 0) {
      toast.error(
        `Can't schedule there — ${conflicts.overCapacity.length} day${conflicts.overCapacity.length === 1 ? " is" : "s are"} already at the ${numCrews}-crew limit.`
      );
      return;
    }
    if (!confirmClashes(crewId, conflicts.laneClash)) return;
    await commitBar({
      projectId,
      projectName: meta?.name ?? "Project",
      crewId,
      dates,
      oldEnd: null,
    });
  }

  async function handleAutoPlan(project: BoardProjectMeta) {
    setBusy(true);
    try {
      const result = await autoPlanProjectBar(project.id);
      if (!result.ok) {
        toast.error(
          `Auto-plan couldn't find room — the next working days are at the ${result.numCrews}-crew limit.`
        );
        return;
      }
      const crewName =
        crews.find((c) => c.id === result.crewId)?.name ?? "a crew";
      toast.success(
        `${project.name}: ${result.days} day${result.days === 1 ? "" : "s"} on ${crewName}, ${formatShort(result.start)}–${formatShort(result.end)} (${
          result.source === "estimate"
            ? "from estimate"
            : result.source === "planned_days"
              ? "from planned days"
              : "no estimate — 1 day"
        }).`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auto-plan failed.");
    } finally {
      setBusy(false);
    }
  }

  // ── render ──
  const todayIndex = days.indexOf(today);
  const monthSpans = useMemo(() => {
    const spans: { label: string; count: number }[] = [];
    for (const day of days) {
      const label = new Date(`${day}T00:00:00`).toLocaleDateString([], {
        month: "long",
        year: "numeric",
      });
      const last = spans[spans.length - 1];
      if (last && last.label === label) last.count += 1;
      else spans.push({ label, count: 1 });
    }
    return spans;
  }, [days]);

  const ghost =
    drag && drag.moved
      ? {
          crewId: drag.candCrewId,
          start: drag.candDates[0],
          end: drag.candDates[drag.candDates.length - 1],
          dates: drag.candDates,
          projectId: drag.bar.projectId,
        }
      : null;

  function renderBarSegments(
    bar: { start: string; end: string; dates: string[]; projectId: string },
    opts: { conflictDates?: Set<string> }
  ) {
    const span = enumerateDays(bar.start, bar.end);
    const dateSet = new Set(bar.dates);
    return span.map((date) => {
      const on = dateSet.has(date);
      const conflicted = opts.conflictDates?.has(date);
      const dayBlockers =
        blockersByProjectDate.get(`${bar.projectId}:${date}`) ?? [];
      return (
        <div
          key={date}
          data-date={date}
          className={cn(
            "relative h-full shrink-0 border-r border-black/5 last:border-r-0 dark:border-white/5",
            !on &&
              "bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(0,0,0,0.08)_3px,rgba(0,0,0,0.08)_6px)] opacity-60",
            conflicted && "bg-destructive/40"
          )}
          style={{ width: dayWidth }}
          title={
            dayBlockers.length > 0
              ? dayBlockers
                  .map(
                    (b) =>
                      `Delay — ${b.code.replaceAll("_", " ").toLowerCase()}${b.note ? `: ${b.note}` : ""}`
                  )
                  .join("\n")
              : undefined
          }
        >
          {dayBlockers.length > 0 ? (
            <span
              aria-hidden
              className="absolute bottom-0 left-1/2 size-0 -translate-x-1/2 border-b-8 border-l-4 border-r-4 border-b-destructive border-l-transparent border-r-transparent"
            />
          ) : null}
        </div>
      );
    });
  }

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="schedule-board"
      // Interactions are ignored while a commit is in flight — E2E waits
      // on this attribute instead of guessing with timeouts.
      data-busy={busy ? "true" : "false"}
    >
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          ariaLabel="Zoom"
          size="sm"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
            { value: "quarter", label: "Quarter" },
          ]}
        />
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Earlier"
            onClick={() =>
              router.replace(
                `/scheduler/board?start=${addDays(windowStart, -dayCount)}`
              )
            }
            className="rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground shadow-e1 hover:bg-muted"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => router.replace(`/scheduler/board`)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1 text-sm font-medium text-foreground shadow-e1 hover:bg-muted"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Later"
            onClick={() =>
              router.replace(
                `/scheduler/board?start=${addDays(windowStart, dayCount)}`
              )
            }
            className="rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground shadow-e1 hover:bg-muted"
          >
            →
          </button>
        </div>
        <span className="num text-sm text-muted-foreground">
          {formatShort(days[0])} – {formatShort(days[days.length - 1])}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-testid="board-paint-toggle"
            aria-pressed={paintMode}
            onClick={() => setPaintMode((on) => !on)}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-sm font-medium shadow-e1 transition-colors",
              paintMode
                ? "border-brand bg-brand-subtle text-foreground"
                : "border-border bg-surface text-muted-foreground hover:text-foreground"
            )}
          >
            {paintMode
              ? "Painting days off — click bar days"
              : "Paint days off"}
          </button>
          <Link
            href={`/scheduler/print?start=${windowStart}`}
            className="rounded-lg border border-border bg-surface px-2.5 py-1 text-sm font-medium text-foreground shadow-e1 hover:bg-muted"
          >
            Print week
          </Link>
        </div>
      </div>

      {/* Fixed overlay, NOT in-flow: mounting an in-flow banner mid-drag
          shifts every lane under the pointer and corrupts hit-testing. */}
      {drag?.moved ? (
        <p
          data-testid="board-drag-status"
          className={cn(
            "fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border px-4 py-1.5 text-sm shadow-e3",
            drag.overCapacity.length > 0
              ? "border-destructive/50 bg-destructive/10 text-destructive"
              : drag.laneClash.length > 0
                ? "border-warning/50 bg-warning/10 text-warning-fg"
                : "border-border bg-surface text-muted-foreground"
          )}
        >
          {drag.projectName}: {formatShort(drag.candDates[0])} –{" "}
          {formatShort(drag.candDates[drag.candDates.length - 1])} ·{" "}
          {drag.candDates.length} day{drag.candDates.length === 1 ? "" : "s"}
          {drag.overCapacity.length > 0
            ? ` · over the ${numCrews}-crew limit on ${drag.overCapacity.length} day${drag.overCapacity.length === 1 ? "" : "s"}`
            : drag.laneClash.length > 0
              ? ` · crew double-booked on ${drag.laneClash.length} day${drag.laneClash.length === 1 ? "" : "s"}`
              : ""}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 xl:flex-row">
        {/* the board */}
        <div className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-border bg-surface shadow-e1">
          <div style={{ width: 176 + days.length * dayWidth }}>
            {/* month header */}
            <div className="flex border-b border-border-subtle">
              <div className="sticky left-0 z-20 w-44 shrink-0 border-r border-border bg-surface" />
              <div className="flex">
                {monthSpans.map((span, i) => (
                  <div
                    key={`${span.label}-${i}`}
                    className="truncate border-r border-border-subtle px-2 py-1 text-xs font-semibold text-muted-foreground last:border-r-0"
                    style={{ width: span.count * dayWidth }}
                  >
                    {span.label}
                  </div>
                ))}
              </div>
            </div>
            {/* day header */}
            <div className="flex border-b border-border">
              <div className="sticky left-0 z-20 flex w-44 shrink-0 items-center border-r border-border bg-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Crew
              </div>
              <div ref={headerDaysRef} className="relative flex">
                {days.map((date) => {
                  const wd = new Date(`${date}T00:00:00`).getDay();
                  const isWorking = workingSet.has(wd);
                  const weekStartTick = wd === 1; // Mondays anchor quarter zoom
                  return (
                    <div
                      key={date}
                      className={cn(
                        "num shrink-0 border-r border-border-subtle py-1 text-center text-[11px] leading-4",
                        !isWorking &&
                          "bg-surface-sunken text-muted-foreground/60",
                        date === today
                          ? "font-bold text-foreground"
                          : "text-muted-foreground"
                      )}
                      style={{ width: dayWidth }}
                    >
                      {zoom === "week" ? (
                        <>
                          <span className="block">
                            {new Date(`${date}T00:00:00`).toLocaleDateString(
                              [],
                              { weekday: "short" }
                            )}
                          </span>
                          <span className="block">
                            {Number(date.slice(8, 10))}
                          </span>
                        </>
                      ) : zoom === "month" ? (
                        Number(date.slice(8, 10))
                      ) : weekStartTick ? (
                        formatShort(date).replace(" ", " ")
                      ) : (
                        ""
                      )}
                    </div>
                  );
                })}
                {todayIndex >= 0 ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-brand"
                    style={{ left: todayIndex * dayWidth + dayWidth / 2 }}
                  />
                ) : null}
              </div>
            </div>

            {/* lanes */}
            {crews.map((crew) => {
              const crewBars = barsByCrew.get(crew.id) ?? [];
              const stacked = stackBars(crewBars);
              // The ghost NEVER affects lane height: if it claimed a track,
              // the growing lane would shift every lane boundary under the
              // stationary pointer and the candidate crew would oscillate
              // between renders mid-drag. It overlays track 0 instead.
              const trackCount = stacked.trackCount;
              const partials = partialsByCrew.get(crew.id) ?? [];
              const laneHeight =
                LANE_PAD * 2 +
                trackCount * BAR_H +
                (trackCount - 1) * TRACK_GAP +
                (partials.length > 0 ? PARTIAL_H + TRACK_GAP : 0);
              const crewMembers = membersByCrew.get(crew.id) ?? [];
              return (
                <div
                  key={crew.id}
                  className="flex border-b border-border-subtle last:border-b-0"
                >
                  <div className="sticky left-0 z-20 w-44 shrink-0 border-r border-border bg-surface px-3 py-2">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {crew.name}
                    </p>
                    <div className="mt-1 flex items-center gap-1">
                      {crewMembers.slice(0, 3).map((name) => (
                        <span
                          key={name}
                          title={name}
                          className="grid size-5 place-items-center rounded-full bg-surface-sunken text-[9px] font-bold text-muted-foreground ring-1 ring-border"
                        >
                          {initials(name)}
                        </span>
                      ))}
                      {crewMembers.length > 3 ? (
                        <span className="text-[10px] text-muted-foreground">
                          +{crewMembers.length - 3}
                        </span>
                      ) : null}
                      {crewMembers.length === 0 ? (
                        <span className="text-[10px] text-muted-foreground">
                          {crew.size} {crew.size === 1 ? "person" : "people"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div
                    ref={(el) => {
                      if (el) laneRefs.current.set(crew.id, el);
                      else laneRefs.current.delete(crew.id);
                    }}
                    className="relative"
                    style={{
                      height: laneHeight,
                      width: days.length * dayWidth,
                    }}
                    // Tray drops land on the LANE, not the day cells: a bar
                    // overlaying a cell would swallow the events (cells are
                    // siblings below bars, so nothing bubbles to them). The
                    // day comes from the pointer's x instead.
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDropTarget(
                        `${crew.id}:${days[dateIndexAt(event.clientX)]}`
                      );
                    }}
                    onDragLeave={(event) => {
                      if (
                        event.currentTarget.contains(
                          event.relatedTarget as Node | null
                        )
                      )
                        return;
                      setDropTarget((c) =>
                        c?.startsWith(`${crew.id}:`) ? null : c
                      );
                    }}
                    onDrop={(event) =>
                      void handleCellDrop(
                        event,
                        crew.id,
                        days[dateIndexAt(event.clientX)]
                      )
                    }
                  >
                    {/* day cells: grid background + tray drop targets */}
                    {days.map((date, i) => {
                      const wd = new Date(`${date}T00:00:00`).getDay();
                      const isWorking = workingSet.has(wd);
                      const overCap =
                        (scheduledProjectsByDate.get(date)?.size ?? 0) >
                        numCrews;
                      const cellKey = `${crew.id}:${date}`;
                      return (
                        <div
                          key={date}
                          data-testid={`board-cell-${crew.id}-${date}`}
                          className={cn(
                            "absolute inset-y-0 border-r border-border-subtle/60",
                            !isWorking && "bg-surface-sunken/70",
                            overCap && "bg-destructive/10",
                            dropTarget === cellKey && "bg-brand-subtle"
                          )}
                          style={{ left: i * dayWidth, width: dayWidth }}
                        />
                      );
                    })}
                    {todayIndex >= 0 ? (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-brand/70"
                        style={{ left: todayIndex * dayWidth + dayWidth / 2 }}
                      />
                    ) : null}

                    {/* bars */}
                    {crewBars.map((bar) => {
                      const track =
                        stacked.trackByKey.get(
                          `${bar.projectId}:${bar.crewId}`
                        ) ?? 0;
                      const startIndex = diffDays(windowStart, bar.start);
                      const endIndex = diffDays(windowStart, bar.end);
                      if (endIndex < 0 || startIndex > days.length - 1)
                        return null;
                      const clampedStart = Math.max(0, startIndex);
                      const clampedEnd = Math.min(days.length - 1, endIndex);
                      const meta = projectById.get(bar.projectId);
                      const isDragSource =
                        drag?.moved &&
                        drag.bar.projectId === bar.projectId &&
                        drag.bar.crewId === bar.crewId;
                      const deadline = meta?.deadline ?? null;
                      const deadlineIndex = deadline
                        ? diffDays(windowStart, deadline)
                        : null;
                      const visibleBar = {
                        ...bar,
                        start: days[clampedStart],
                        end: days[clampedEnd],
                      };
                      const workedDays = bar.dates.length;
                      return (
                        <div key={`${bar.projectId}:${bar.crewId}`}>
                          <div
                            data-testid={`board-bar-${bar.projectId}`}
                            onPointerDown={(event) =>
                              beginDrag(event, bar, "move")
                            }
                            onPointerMove={updateDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={() => setDrag(null)}
                            className={cn(
                              "absolute z-[5] flex touch-none select-none overflow-hidden rounded-md border border-black/10 border-l-4 shadow-e1 dark:border-white/10",
                              colorForProject(bar.projectId),
                              paintMode
                                ? "cursor-crosshair"
                                : "cursor-grab active:cursor-grabbing",
                              isDragSource && "opacity-30"
                            )}
                            style={{
                              left: clampedStart * dayWidth,
                              width: (clampedEnd - clampedStart + 1) * dayWidth,
                              top: LANE_PAD + track * (BAR_H + TRACK_GAP),
                              height: BAR_H,
                            }}
                          >
                            {renderBarSegments(visibleBar, {})}
                            {/* label overlay */}
                            <div className="pointer-events-none absolute inset-0 flex items-center gap-1.5 px-2">
                              <span className="truncate text-xs font-semibold">
                                {meta?.name ?? "Project"}
                              </span>
                              {zoom !== "quarter" ? (
                                <span className="num shrink-0 text-[10px] opacity-70">
                                  {workedDays}d
                                </span>
                              ) : null}
                            </div>
                            {/* resize handles */}
                            {!paintMode ? (
                              <>
                                <div
                                  data-testid={`board-handle-start-${bar.projectId}`}
                                  onPointerDown={(event) => {
                                    event.stopPropagation();
                                    beginDrag(event, bar, "resize-start");
                                  }}
                                  onPointerMove={updateDrag}
                                  onPointerUp={endDrag}
                                  className="absolute inset-y-0 left-0 w-2 cursor-ew-resize touch-none"
                                />
                                <div
                                  data-testid={`board-handle-end-${bar.projectId}`}
                                  onPointerDown={(event) => {
                                    event.stopPropagation();
                                    beginDrag(event, bar, "resize-end");
                                  }}
                                  onPointerMove={updateDrag}
                                  onPointerUp={endDrag}
                                  className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none"
                                />
                              </>
                            ) : null}
                          </div>
                          {/* milestone diamond: the project's deadline */}
                          {deadlineIndex !== null &&
                          deadlineIndex >= 0 &&
                          deadlineIndex <= days.length - 1 ? (
                            <div
                              aria-hidden
                              title={`Deadline — ${meta?.name}: ${deadline}`}
                              className="absolute z-[6] size-2.5 rotate-45 bg-foreground ring-2 ring-surface"
                              style={{
                                left:
                                  deadlineIndex * dayWidth + dayWidth / 2 - 5,
                                top: LANE_PAD + track * (BAR_H + TRACK_GAP) - 5,
                              }}
                            />
                          ) : null}
                        </div>
                      );
                    })}

                    {/* row/phase-scoped strips */}
                    {partials.map((p) => {
                      const startIndex = Math.max(
                        0,
                        diffDays(windowStart, p.start)
                      );
                      const endIndex = Math.min(
                        days.length - 1,
                        diffDays(windowStart, p.end)
                      );
                      if (endIndex < 0 || startIndex > days.length - 1)
                        return null;
                      const meta = projectById.get(p.projectId);
                      return (
                        <div
                          key={`partial-${p.projectId}`}
                          title={`${meta?.name ?? "Project"} — row/phase-scoped days (manage on the project's schedule page)`}
                          className={cn(
                            "absolute rounded-sm border border-black/10 opacity-70 dark:border-white/10",
                            colorForProject(p.projectId)
                          )}
                          style={{
                            left: startIndex * dayWidth,
                            width: (endIndex - startIndex + 1) * dayWidth,
                            bottom: LANE_PAD / 2,
                            height: PARTIAL_H,
                          }}
                        />
                      );
                    })}

                    {/* live drag ghost */}
                    {ghost && ghost.crewId === crew.id ? (
                      <div
                        data-testid="board-ghost"
                        className={cn(
                          "pointer-events-none absolute z-20 flex overflow-hidden rounded-md border-2 border-dashed",
                          drag!.overCapacity.length > 0
                            ? "border-destructive bg-destructive/15"
                            : drag!.laneClash.length > 0
                              ? "border-warning bg-warning/15"
                              : "border-brand bg-brand-subtle/80"
                        )}
                        style={{
                          left:
                            Math.max(0, diffDays(windowStart, ghost.start)) *
                            dayWidth,
                          width:
                            (Math.min(
                              days.length - 1,
                              diffDays(windowStart, ghost.end)
                            ) -
                              Math.max(0, diffDays(windowStart, ghost.start)) +
                              1) *
                            dayWidth,
                          top: LANE_PAD,
                          height: BAR_H,
                        }}
                      >
                        {renderBarSegments(ghost, {
                          conflictDates: new Set([
                            ...drag!.laneClash,
                            ...drag!.overCapacity,
                          ]),
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {crews.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Add a crew on the Scheduler page first.
              </p>
            ) : null}
          </div>
        </div>

        {/* unscheduled tray */}
        <aside className="w-full shrink-0 xl:w-64">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Unscheduled
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Drag a project onto a crew&apos;s lane, or auto-plan it from the
            estimate.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {unscheduled.map((project) => (
              <div
                key={project.id}
                data-testid={`board-tray-${project.id}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(PROJECT_DATA_TYPE, project.id);
                }}
                className={cn(
                  "cursor-grab rounded-lg border border-black/10 border-l-4 px-2.5 py-2 shadow-e1 dark:border-white/10",
                  colorForProject(project.id)
                )}
              >
                <p className="truncate text-sm font-semibold">{project.name}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="num text-[11px] opacity-70">
                    {project.plannedDays
                      ? `${project.plannedDays} planned day${project.plannedDays === 1 ? "" : "s"}`
                      : "no plan yet"}
                    {project.deadline
                      ? ` · due ${formatShort(project.deadline)}`
                      : ""}
                  </span>
                  <button
                    type="button"
                    data-testid={`board-autoplan-${project.id}`}
                    disabled={busy}
                    onClick={() => void handleAutoPlan(project)}
                    className="shrink-0 rounded-md bg-surface px-2 py-0.5 text-[11px] font-semibold text-foreground shadow-e1 ring-1 ring-border hover:bg-muted disabled:opacity-50"
                  >
                    Auto-plan
                  </button>
                </div>
              </div>
            ))}
            {unscheduled.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
                Every active project is on the board.
              </p>
            ) : null}
          </div>

          {/* legend */}
          <div className="mt-4 flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-6 rounded-sm border border-black/10 border-l-4 border-l-amber-500 bg-amber-100" />
              scheduled day
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-6 rounded-sm border border-border bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(0,0,0,0.12)_3px,rgba(0,0,0,0.12)_6px)]" />
              painted off / skip day
            </span>
            <span className="flex items-center gap-2">
              <span className="size-0 border-b-8 border-l-4 border-r-4 border-b-destructive border-l-transparent border-r-transparent" />
              delay day (blocker w/ reason)
            </span>
            <span className="flex items-center gap-2">
              <span className="size-2 rotate-45 bg-foreground" /> deadline
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-6 rounded-sm bg-destructive/10 ring-1 ring-destructive/30" />
              day at the {numCrews}-crew limit
            </span>
          </div>
        </aside>
      </div>

      {/* notify-customer dialog (reuses the comms finish-changed flow) */}
      {notifyDraft ? (
        <NotifyCustomerDialog
          draft={notifyDraft}
          onClose={() => setNotifyDraft(null)}
        />
      ) : null}
    </div>
  );
}

function NotifyCustomerDialog({
  draft,
  onClose,
}: {
  draft: {
    projectId: string;
    projectName: string;
    oldFinish: string | null;
    newFinish: string;
  };
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      await sendFinishChangedNotice(draft.projectId, {
        oldFinish: draft.oldFinish,
        newFinish: draft.newFinish,
        reason,
      });
      toast.success("Customer notified of the schedule change.");
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send the notice."
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Notify customer of schedule change"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-4 shadow-e4">
        <h2 className="text-base font-semibold text-foreground">
          Notify the customer
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {draft.projectName}:{" "}
          {draft.oldFinish
            ? `finish moves ${draft.oldFinish} → `
            : "finish is "}
          <span className="font-medium text-foreground">{draft.newFinish}</span>
          . A customer-facing reason is required.
        </p>
        <Textarea
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Material arrival slipped two days; crew resequenced."
          className="mt-3"
          rows={3}
          data-testid="board-notify-reason"
        />
        {error ? (
          <p className="mt-2 text-sm text-destructive">{error}</p>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground shadow-e1 hover:bg-muted"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={sending || !reason.trim()}
            onClick={() => void handleSend()}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-e1 hover:bg-[var(--brand-hover)] disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send notice"}
          </button>
        </div>
      </div>
    </div>
  );
}
