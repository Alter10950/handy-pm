import { expect, test, type Page } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { clearDispatchGate } from "./helpers/gates";
import { createAdminClient } from "./helpers/supabase-admin";

// Design pass v3 F1 — the drag-drop schedule board: tray drop sized by
// planned days, bar move (working-day aware), edge resize, cross-lane
// crew reassignment, double-booking confirm, and paint-days-off. Every
// assertion checks the DATABASE (the assignments table is the source of
// truth), not just rendered CSS.

const STAMP = Date.now();
const PROJECT_A_NAME = `[E2E] Board A ${STAMP}`;
const PROJECT_B_NAME = `[E2E] Board B ${STAMP}`;
const CREW_1_NAME = `[E2E] Board crew 1 ${STAMP}`;
const CREW_2_NAME = `[E2E] Board crew 2 ${STAMP}`;

let projectAId: string | null = null;
let projectBId: string | null = null;
const crewIds: string[] = [];

// ── local date math (mirrors lib/scheduler/board.ts on purpose: the
// spec computes EXPECTED dates independently instead of trusting the
// implementation's own helpers) ──
function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getDay();
}
function fillWorking(
  start: string,
  count: number,
  working: Set<number>
): string[] {
  const out: string[] = [];
  let cursor = start;
  while (out.length < count) {
    if (working.has(weekdayOf(cursor))) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

// The board window: 8 weeks out, far from any other spec's near-today
// schedule rows (capacity is a shared, org-wide hard limit).
const today = new Date().toISOString().slice(0, 10);
const windowStart = addDays(today, 56 - weekdayOf(today)); // a Sunday
const boardUrl = `/scheduler/board?start=${windowStart}`;

async function assignedDates(
  projectId: string,
  crewId?: string
): Promise<string[]> {
  const admin = createAdminClient();
  let query = admin
    .from("assignments")
    .select("work_date, crew_id")
    .eq("project_id", projectId)
    .is("row_id", null);
  if (crewId) query = query.eq("crew_id", crewId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => r.work_date as string).sort();
}

// A commit's DB rows land BEFORE the server action returns to the client
// (schedule sync + gate ticks follow the insert), and the board ignores
// pointer input while busy — so after every DB poll, wait for the board
// to report idle before the next interaction.
async function awaitIdle(page: Page) {
  await page
    .locator('[data-testid="schedule-board"][data-busy="false"]')
    .waitFor({ timeout: 15_000 });
}

async function dragBar(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Several intermediate moves so the pointer-capture drag sees real
  // pointermove events (a single jump can be swallowed as a click).
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
}

test.afterAll(async () => {
  if (projectAId) await deleteProjectCompletely(projectAId);
  if (projectBId) await deleteProjectCompletely(projectBId);
  const admin = createAdminClient();
  for (const id of crewIds) await admin.from("crews").delete().eq("id", id);
});

test("schedule board: tray drop, drag move, edge resize, crew reassign, double-book confirm, paint day off", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const admin = createAdminClient();
  let working = new Set([1, 2, 3, 4, 5]);

  await test.step("setup: two projects (dispatch-cleared), two crews", async () => {
    for (const [name, setId] of [
      [PROJECT_A_NAME, (id: string) => (projectAId = id)],
      [PROJECT_B_NAME, (id: string) => (projectBId = id)],
    ] as const) {
      await page.goto("/app");
      await page.getByRole("button", { name: "+ New project" }).click();
      await page.locator("#name").fill(name);
      await page.getByRole("button", { name: "Create project" }).click();
      await page.waitForURL(/\/app\/project\/[^/]+$/);
      setId(/\/app\/project\/([^/]+)$/.exec(page.url())![1]);
    }
    await clearDispatchGate(projectAId!);
    await clearDispatchGate(projectBId!);

    const { data: org } = await admin
      .from("projects")
      .select("org_id")
      .eq("id", projectAId!)
      .single();
    const { data: orgRow } = await admin
      .from("organizations")
      .select("default_working_days")
      .eq("id", org!.org_id)
      .single();
    if (orgRow?.default_working_days?.length) {
      working = new Set(orgRow.default_working_days);
    }

    // Tray drops size themselves from planned_days.
    await admin
      .from("projects")
      .update({ planned_days: 3 })
      .eq("id", projectAId!);

    for (const name of [CREW_1_NAME, CREW_2_NAME]) {
      const { data: crew, error } = await admin
        .from("crews")
        .insert({ org_id: org!.org_id, name, size: 2 })
        .select("id")
        .single();
      if (error) throw error;
      crewIds.push(crew.id);
    }
  });

  // Deterministic anchor: the Monday of the far-future board window.
  const monday = addDays(windowStart, 1);

  await test.step("tray drop schedules planned_days working days", async () => {
    await page.goto(boardUrl);
    await page
      .getByTestId(`board-tray-${projectAId}`)
      .dragTo(page.getByTestId(`board-cell-${crewIds[0]}-${monday}`));

    const expected = fillWorking(monday, 3, working);
    await expect
      .poll(() => assignedDates(projectAId!, crewIds[0]))
      .toEqual(expected);
    await expect(page.getByTestId(`board-bar-${projectAId}`)).toBeVisible();
    await awaitIdle(page);
  });

  await test.step("drag the bar two days later — dates shift along working days", async () => {
    const bar = page.getByTestId(`board-bar-${projectAId}`);
    const barBox = (await bar.boundingBox())!;
    const targetDate = addDays(monday, 2); // Wednesday
    const cellBox = (await page
      .getByTestId(`board-cell-${crewIds[0]}-${targetDate}`)
      .boundingBox())!;

    // Grab inside the FIRST day of the bar (past the 8px resize handle).
    await dragBar(
      page,
      { x: barBox.x + 20, y: barBox.y + barBox.height / 2 },
      { x: cellBox.x + cellBox.width / 2, y: barBox.y + barBox.height / 2 }
    );

    const expected = fillWorking(targetDate, 3, working);
    await expect
      .poll(() => assignedDates(projectAId!, crewIds[0]))
      .toEqual(expected);
    await awaitIdle(page);
  });

  await test.step("grab the right edge and stretch two more working days", async () => {
    const before = await assignedDates(projectAId!, crewIds[0]);
    const end = before[before.length - 1];
    const newEnd = fillWorking(addDays(end, 1), 2, working)[1];

    const handle = page.getByTestId(`board-handle-end-${projectAId}`);
    const handleBox = (await handle.boundingBox())!;
    const cellBox = (await page
      .getByTestId(`board-cell-${crewIds[0]}-${newEnd}`)
      .boundingBox())!;

    await dragBar(
      page,
      { x: handleBox.x + handleBox.width / 2, y: handleBox.y + 10 },
      { x: cellBox.x + cellBox.width / 2, y: handleBox.y + 10 }
    );

    await expect
      .poll(() => assignedDates(projectAId!, crewIds[0]))
      .toEqual([...before, ...fillWorking(addDays(end, 1), 2, working)]);
    await awaitIdle(page);
  });

  await test.step("drag the bar onto the other crew's lane — crew reassigned, dates intact", async () => {
    const before = await assignedDates(projectAId!, crewIds[0]);
    const bar = page.getByTestId(`board-bar-${projectAId}`);
    const barBox = (await bar.boundingBox())!;
    const targetCell = (await page
      .getByTestId(`board-cell-${crewIds[1]}-${before[0]}`)
      .boundingBox())!;

    await dragBar(
      page,
      { x: barBox.x + 20, y: barBox.y + barBox.height / 2 },
      { x: barBox.x + 20, y: targetCell.y + targetCell.height / 2 }
    );

    await expect
      .poll(() => assignedDates(projectAId!, crewIds[1]))
      .toEqual(before);
    expect(await assignedDates(projectAId!, crewIds[0])).toEqual([]);
    await awaitIdle(page);
  });

  await test.step("dropping project B on the same crew and days asks before double-booking", async () => {
    const aDates = await assignedDates(projectAId!, crewIds[1]);

    const [dialog] = await Promise.all([
      page.waitForEvent("dialog"),
      page
        .getByTestId(`board-tray-${projectBId}`)
        // force: bar A covers this cell (that's the point of the test), so
        // the actionability check would stall; events bubble to the lane.
        .dragTo(page.getByTestId(`board-cell-${crewIds[1]}-${aDates[0]}`), {
          force: true,
        }),
    ]);
    expect(dialog.message()).toContain("already has another project");
    await dialog.accept();

    await expect
      .poll(() => assignedDates(projectBId!, crewIds[1]))
      .toEqual([aDates[0]]); // no planned_days → 1-day bar
    await awaitIdle(page);
  });

  await test.step("paint mode: click a middle day off, then back on", async () => {
    const before = await assignedDates(projectAId!, crewIds[1]);
    const middle = before[2];

    await page.getByTestId("board-paint-toggle").click();
    const cellBox = (await page
      .getByTestId(`board-cell-${crewIds[1]}-${middle}`)
      .boundingBox())!;
    const barBox = (await page
      .getByTestId(`board-bar-${projectAId}`)
      .boundingBox())!;

    // Click the bar at that day's x — paint OFF.
    await page.mouse.click(
      cellBox.x + cellBox.width / 2,
      barBox.y + barBox.height / 2
    );
    await expect
      .poll(() => assignedDates(projectAId!, crewIds[1]))
      .toEqual(before.filter((d) => d !== middle));
    await awaitIdle(page);

    // Same spot again — the hollow segment is still part of the bar span;
    // clicking it paints the day back ON.
    await page.mouse.click(
      cellBox.x + cellBox.width / 2,
      barBox.y + barBox.height / 2
    );
    await expect
      .poll(() => assignedDates(projectAId!, crewIds[1]))
      .toEqual(before);
  });

  await test.step("project_schedule mirrors the bar for capacity math", async () => {
    const dates = await assignedDates(projectAId!, crewIds[1]);
    const { data } = await admin
      .from("project_schedule")
      .select("work_date")
      .eq("project_id", projectAId!);
    const scheduled = (data ?? []).map((r) => r.work_date as string).sort();
    expect(scheduled).toEqual(dates);
  });
});
