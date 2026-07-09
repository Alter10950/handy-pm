// Relative import (not "@/lib/dates") so node --test can run the unit
// tests without alias resolution — same reasoning as the engine tests.
import { addDays } from "../dates.ts";

// Pure geometry + conflict math for the drag-drop schedule board (design
// pass v3 F1). No Supabase, no React — everything here is unit-testable
// with plain node --test, and shared verbatim by the client board (live
// drag preview) and the server actions (authoritative commit).
//
// The data model is the existing one: an assignment row per
// (project, crew, work_date). A "bar" on the board is simply every
// whole-project (row_id null) assignment a crew has for a project,
// rendered as one span from its first to its last date. Days inside the
// span with no assignment row are SKIP days (painted off — holiday, crew
// pulled elsewhere) and render hollow.

export interface BoardAssignment {
  id: string;
  projectId: string;
  crewId: string;
  rowId: string | null;
  workDate: string;
}

export interface ProjectBar {
  projectId: string;
  crewId: string;
  /** the assignment dates, ascending, unique */
  dates: string[];
  start: string;
  end: string;
}

/** Inclusive day-by-day enumeration of a YYYY-MM-DD range. */
export function enumerateDays(start: string, endInclusive: string): string[] {
  if (start > endInclusive) return [];
  const out: string[] = [];
  let cursor = start;
  while (cursor <= endInclusive) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** 0–6 weekday (JS getDay semantics) for a YYYY-MM-DD string. */
export function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getDay();
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Group whole-project assignments into one bar per project × crew. */
export function barsFromAssignments(
  assignments: BoardAssignment[]
): ProjectBar[] {
  const byKey = new Map<string, BoardAssignment[]>();
  for (const a of assignments) {
    if (a.rowId !== null) continue; // row/phase-scoped: not a board bar
    const key = `${a.projectId}:${a.crewId}`;
    const list = byKey.get(key) ?? [];
    list.push(a);
    byKey.set(key, list);
  }
  const bars: ProjectBar[] = [];
  for (const list of byKey.values()) {
    const dates = [...new Set(list.map((a) => a.workDate))].sort();
    bars.push({
      projectId: list[0].projectId,
      crewId: list[0].crewId,
      dates,
      start: dates[0],
      end: dates[dates.length - 1],
    });
  }
  return bars.sort(
    (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)
  );
}

/** First date ≥ `from` whose weekday is a working day. */
export function snapToWorkingDay(
  from: string,
  workingWeekdays: Set<number>
): string {
  let cursor = from;
  // A fully-empty working-day set would loop forever — treat it as "any
  // day works" instead of hanging.
  if (workingWeekdays.size === 0) return cursor;
  while (!workingWeekdays.has(weekdayOf(cursor))) {
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

/**
 * `count` working dates starting at (or after) `start`, skipping
 * non-working weekdays and any explicitly blocked dates (e.g. days
 * already at crew capacity).
 */
export function fillWorkingDays(
  start: string,
  count: number,
  workingWeekdays: Set<number>,
  blockedDates?: Set<string>
): string[] {
  const out: string[] = [];
  if (count <= 0) return out;
  let cursor = start;
  // Hard stop well past any real schedule so bad input can't spin.
  for (let guard = 0; guard < 3660 && out.length < count; guard += 1) {
    const workable =
      workingWeekdays.size === 0 || workingWeekdays.has(weekdayOf(cursor));
    if (workable && !blockedDates?.has(cursor)) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/**
 * Dates for a MOVED bar: the drop day (snapped forward to a working day)
 * becomes the new start, and the bar keeps its duration in working days.
 * Painted skip days do NOT travel with the bar — they were date-specific
 * (a holiday, a crew pulled for a day), not part of the project's shape.
 */
export function moveBarDates(
  bar: Pick<ProjectBar, "dates">,
  newStart: string,
  workingWeekdays: Set<number>
): string[] {
  return fillWorkingDays(
    snapToWorkingDay(newStart, workingWeekdays),
    bar.dates.length,
    workingWeekdays
  );
}

/**
 * Dates for a RESIZED bar. The fixed edge stays put; the dragged edge
 * moves to `newEdgeDate`. Days newly brought into the span fill along
 * working weekdays; days that were painted off inside the surviving part
 * of the old span STAY off (a resize shouldn't silently reinstate a
 * holiday you painted out).
 */
export function resizeBarDates(
  bar: Pick<ProjectBar, "dates" | "start" | "end">,
  edge: "start" | "end",
  newEdgeDate: string,
  workingWeekdays: Set<number>
): string[] {
  const newStart = edge === "start" ? newEdgeDate : bar.start;
  const newEnd = edge === "end" ? newEdgeDate : bar.end;
  if (newStart > newEnd) {
    // Collapsed past the fixed edge — keep the minimum one-day bar on the
    // fixed edge rather than deleting the assignment out from under a
    // slightly-overshot drag.
    return edge === "start" ? [bar.end] : [bar.start];
  }
  const oldSet = new Set(bar.dates);
  const skipped = new Set(
    enumerateDays(bar.start, bar.end).filter((d) => !oldSet.has(d))
  );
  const result = enumerateDays(newStart, newEnd).filter((d) => {
    if (skipped.has(d)) return false; // painted off — stays off
    if (oldSet.has(d)) return true; // existing day survives as-is
    return workingWeekdays.size === 0 || workingWeekdays.has(weekdayOf(d));
  });
  // Same overshoot guard as above: never resize a bar into nothing.
  return result.length > 0 ? result : [edge === "start" ? bar.end : bar.start];
}

export interface BoardConflicts {
  /** dates where the target crew already works a DIFFERENT project */
  laneClash: string[];
  /** dates where the org would need more concurrent crews than it has */
  overCapacity: string[];
}

/**
 * Live conflict check for a candidate bar placement. `assignments` is
 * everything on the board; the bar being edited is identified by
 * `exclude` so its own current rows don't clash with themselves.
 * Capacity follows ADR-044: the number of DISTINCT projects scheduled on
 * a date (project_schedule ∪ the candidate) can't exceed numCrews.
 */
export function findBoardConflicts(input: {
  projectId: string;
  crewId: string;
  dates: string[];
  assignments: BoardAssignment[];
  scheduledProjectsByDate: Map<string, Set<string>>;
  numCrews: number;
  exclude?: { projectId: string; crewId: string };
}): BoardConflicts {
  const { projectId, crewId, dates, assignments, exclude } = input;
  const dateSet = new Set(dates);

  const laneClash = new Set<string>();
  for (const a of assignments) {
    if (a.crewId !== crewId) continue;
    if (a.projectId === projectId) continue;
    if (
      exclude &&
      a.projectId === exclude.projectId &&
      a.crewId === exclude.crewId &&
      a.rowId === null
    )
      continue;
    if (dateSet.has(a.workDate)) laneClash.add(a.workDate);
  }

  const overCapacity: string[] = [];
  for (const date of dates) {
    const others = new Set(input.scheduledProjectsByDate.get(date) ?? []);
    others.delete(projectId);
    if (others.size + 1 > input.numCrews) overCapacity.push(date);
  }

  return { laneClash: [...laneClash].sort(), overCapacity };
}

/**
 * Stack overlapping bars in a lane into tracks (rows within the lane) so
 * two projects on one crew render side by side instead of on top of each
 * other. Returns the track index per bar key `projectId:crewId` and the
 * number of tracks used.
 */
export function stackBars(bars: ProjectBar[]): {
  trackByKey: Map<string, number>;
  trackCount: number;
} {
  const sorted = [...bars].sort(
    (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)
  );
  const trackEnds: string[] = []; // last occupied end date per track
  const trackByKey = new Map<string, number>();
  for (const bar of sorted) {
    let placed = false;
    for (let t = 0; t < trackEnds.length; t += 1) {
      if (trackEnds[t] < bar.start) {
        trackEnds[t] = bar.end;
        trackByKey.set(`${bar.projectId}:${bar.crewId}`, t);
        placed = true;
        break;
      }
    }
    if (!placed) {
      trackEnds.push(bar.end);
      trackByKey.set(`${bar.projectId}:${bar.crewId}`, trackEnds.length - 1);
    }
  }
  return { trackByKey, trackCount: Math.max(1, trackEnds.length) };
}
