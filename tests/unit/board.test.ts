// Unit tests for the schedule board's pure geometry/conflict math
// (design pass v3 F1) — run via `npm run test:unit` (node --test with
// native type stripping). Relative imports on purpose: node --test
// doesn't resolve the "@/" alias.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  barsFromAssignments,
  diffDays,
  enumerateDays,
  fillWorkingDays,
  findBoardConflicts,
  moveBarDates,
  resizeBarDates,
  snapToWorkingDay,
  stackBars,
  weekdayOf,
} from "../../lib/scheduler/board.ts";
import type { BoardAssignment } from "../../lib/scheduler/board.ts";

const WEEKDAYS = new Set([1, 2, 3, 4, 5]); // Mon–Fri

function a(
  projectId: string,
  crewId: string,
  workDate: string,
  rowId: string | null = null
): BoardAssignment {
  return {
    id: `${projectId}:${crewId}:${workDate}`,
    projectId,
    crewId,
    rowId,
    workDate,
  };
}

test("enumerateDays is inclusive and ordered; empty when reversed", () => {
  assert.deepEqual(enumerateDays("2026-07-06", "2026-07-08"), [
    "2026-07-06",
    "2026-07-07",
    "2026-07-08",
  ]);
  assert.deepEqual(enumerateDays("2026-07-08", "2026-07-06"), []);
});

test("diffDays and weekdayOf agree with the calendar", () => {
  assert.equal(diffDays("2026-07-06", "2026-07-09"), 3);
  assert.equal(diffDays("2026-07-09", "2026-07-06"), -3);
  assert.equal(weekdayOf("2026-07-06"), 1); // a Monday
  assert.equal(weekdayOf("2026-07-11"), 6); // that Saturday
});

test("barsFromAssignments groups whole-project rows per project×crew and ignores row-scoped ones", () => {
  const bars = barsFromAssignments([
    a("p1", "c1", "2026-07-07"),
    a("p1", "c1", "2026-07-06"),
    a("p1", "c1", "2026-07-09"), // gap on the 8th = skip day
    a("p2", "c1", "2026-07-06"),
    a("p1", "c2", "2026-07-06"),
    a("p1", "c1", "2026-07-10", "row-9"), // row-scoped: not a bar
  ]);
  assert.equal(bars.length, 3);
  const p1c1 = bars.find((b) => b.projectId === "p1" && b.crewId === "c1")!;
  assert.deepEqual(p1c1.dates, ["2026-07-06", "2026-07-07", "2026-07-09"]);
  assert.equal(p1c1.start, "2026-07-06");
  assert.equal(p1c1.end, "2026-07-09");
});

test("snapToWorkingDay rolls a weekend forward to Monday", () => {
  assert.equal(snapToWorkingDay("2026-07-11", WEEKDAYS), "2026-07-13");
  assert.equal(snapToWorkingDay("2026-07-08", WEEKDAYS), "2026-07-08");
});

test("fillWorkingDays skips weekends and blocked dates", () => {
  // Fri Jul 10 start, 3 working days, Jul 13 (Mon) blocked → Fri, Tue, Wed
  assert.deepEqual(
    fillWorkingDays("2026-07-10", 3, WEEKDAYS, new Set(["2026-07-13"])),
    ["2026-07-10", "2026-07-14", "2026-07-15"]
  );
});

test("moveBarDates keeps working-day duration and drops painted skips", () => {
  // Mon–Thu bar with Wed painted off (3 working dates). Moved to the next
  // Monday it becomes Mon+Tue+Wed — same COUNT, skip does not travel.
  const bar = { dates: ["2026-07-06", "2026-07-07", "2026-07-09"] };
  assert.deepEqual(moveBarDates(bar, "2026-07-13", WEEKDAYS), [
    "2026-07-13",
    "2026-07-14",
    "2026-07-15",
  ]);
});

test("moveBarDates dropped on a Saturday snaps to Monday", () => {
  const bar = { dates: ["2026-07-06", "2026-07-07"] };
  assert.deepEqual(moveBarDates(bar, "2026-07-11", WEEKDAYS), [
    "2026-07-13",
    "2026-07-14",
  ]);
});

test("resizeBarDates end-extend fills working days and skips the weekend", () => {
  const bar = {
    dates: ["2026-07-09", "2026-07-10"],
    start: "2026-07-09",
    end: "2026-07-10",
  };
  // Thu–Fri extended through next Tuesday → Thu, Fri, Mon, Tue
  assert.deepEqual(resizeBarDates(bar, "end", "2026-07-14", WEEKDAYS), [
    "2026-07-09",
    "2026-07-10",
    "2026-07-13",
    "2026-07-14",
  ]);
});

test("resizeBarDates preserves interior painted skip days", () => {
  const bar = {
    dates: ["2026-07-06", "2026-07-08"], // Tue the 7th painted off
    start: "2026-07-06",
    end: "2026-07-08",
  };
  assert.deepEqual(resizeBarDates(bar, "end", "2026-07-09", WEEKDAYS), [
    "2026-07-06",
    "2026-07-08",
    "2026-07-09",
  ]);
});

test("resizeBarDates start-trim keeps later days; overshoot never deletes the bar", () => {
  const bar = {
    dates: ["2026-07-06", "2026-07-07", "2026-07-08"],
    start: "2026-07-06",
    end: "2026-07-08",
  };
  assert.deepEqual(resizeBarDates(bar, "start", "2026-07-07", WEEKDAYS), [
    "2026-07-07",
    "2026-07-08",
  ]);
  // Dragged the start edge past the end — collapse to one day, not zero.
  assert.deepEqual(resizeBarDates(bar, "start", "2026-07-20", WEEKDAYS), [
    "2026-07-08",
  ]);
});

test("findBoardConflicts flags lane clashes only for other projects on the target crew", () => {
  const assignments = [
    a("p2", "c1", "2026-07-07"),
    a("p2", "c2", "2026-07-08"), // other crew — irrelevant
    a("p1", "c1", "2026-07-08"), // own project — not a clash
  ];
  const { laneClash } = findBoardConflicts({
    projectId: "p1",
    crewId: "c1",
    dates: ["2026-07-06", "2026-07-07", "2026-07-08"],
    assignments,
    scheduledProjectsByDate: new Map(),
    numCrews: 2,
  });
  assert.deepEqual(laneClash, ["2026-07-07"]);
});

test("findBoardConflicts excludes the bar being edited from clashing with itself", () => {
  const assignments = [a("p1", "c1", "2026-07-07")];
  const { laneClash } = findBoardConflicts({
    projectId: "p1",
    crewId: "c1",
    dates: ["2026-07-07"],
    assignments,
    scheduledProjectsByDate: new Map(),
    numCrews: 2,
    exclude: { projectId: "p1", crewId: "c1" },
  });
  assert.deepEqual(laneClash, []);
});

test("findBoardConflicts enforces the distinct-projects-per-day capacity rule (ADR-044)", () => {
  const scheduled = new Map([
    ["2026-07-07", new Set(["p2", "p3"])], // already 2 other projects
    ["2026-07-08", new Set(["p2"])],
    ["2026-07-09", new Set(["p2", "p1"])], // own project already counted
  ]);
  const { overCapacity } = findBoardConflicts({
    projectId: "p1",
    crewId: "c1",
    dates: ["2026-07-07", "2026-07-08", "2026-07-09"],
    assignments: [],
    scheduledProjectsByDate: scheduled,
    numCrews: 2,
  });
  assert.deepEqual(overCapacity, ["2026-07-07"]);
});

test("stackBars gives overlapping bars separate tracks and reuses free ones", () => {
  const bars = barsFromAssignments([
    a("p1", "c1", "2026-07-06"),
    a("p1", "c1", "2026-07-07"),
    a("p2", "c1", "2026-07-07"), // overlaps p1 → track 1
    a("p3", "c1", "2026-07-09"), // after p1 ends → back on track 0
  ]);
  const { trackByKey, trackCount } = stackBars(bars);
  assert.equal(trackCount, 2);
  assert.equal(trackByKey.get("p1:c1"), 0);
  assert.equal(trackByKey.get("p2:c1"), 1);
  assert.equal(trackByKey.get("p3:c1"), 0);
});
