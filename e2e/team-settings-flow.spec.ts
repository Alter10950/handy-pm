import { expect, test } from "@playwright/test";

import { deleteAuthUserByEmail } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const CREW_NAME = `[E2E] Settings crew ${Date.now()}`;
const MEMBER_EMAIL = `e2e+settings-member-${Date.now()}@handyequip.test`;
const CREW_ROLE_EMAIL = `e2e+settings-crew-role-${Date.now()}@handyequip.test`;
const CREW_ROLE_PASSWORD = "e2e-crew-role-password-1!";

let crewRoleUserId: string | null = null;
let originalOwnerName: string | null | undefined;
let originalOrg: {
  id: string;
  name: string;
  address: string | null;
  default_working_days: number[];
  logo_path: string | null;
} | null = null;

test.beforeAll(async () => {
  const admin = createAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("id, name, address, default_working_days, logo_path")
    .limit(1)
    .single();
  originalOrg = data;
});

test.afterAll(async () => {
  const admin = createAdminClient();
  await deleteAuthUserByEmail(MEMBER_EMAIL);
  if (crewRoleUserId) {
    await admin.auth.admin.deleteUser(crewRoleUserId);
  }
  await admin.from("crews").delete().eq("name", CREW_NAME);
  // Restore the shared org row and the seeded owner's name — unlike
  // [E2E]-prefixed projects/crews, there's only one org and one seeded
  // owner, so this suite has to put them back rather than just deleting
  // test-namespaced rows.
  if (originalOrg) {
    await admin
      .from("organizations")
      .update({
        name: originalOrg.name,
        address: originalOrg.address,
        default_working_days: originalOrg.default_working_days,
        logo_path: originalOrg.logo_path,
      })
      .eq("id", originalOrg.id);
  }
  if (originalOwnerName !== undefined) {
    const { data: owner } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();
    if (owner) {
      await admin
        .from("profiles")
        .update({ full_name: originalOwnerName })
        .eq("id", owner.id);
    }
  }
});

test("team: assign a member to a crew", async ({ page }) => {
  await test.step("create a crew via Scheduler", async () => {
    await page.goto("/scheduler");
    await page.getByRole("button", { name: "+ New crew" }).click();
    await page.getByPlaceholder("Crew name").fill(CREW_NAME);
    await page.getByRole("button", { name: "Create crew" }).click();
    await expect(page.getByText(CREW_NAME)).toBeVisible();
  });

  await test.step("create a team member", async () => {
    await page.goto("/app/team");
    await page.getByRole("button", { name: "+ Add team member" }).click();
    await page.locator("#email").fill(MEMBER_EMAIL);
    await page.locator("#full_name").fill("E2E Settings Member");
    await page.locator("#role").selectOption("crew");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(
      page.getByRole("button", { name: "Create account" })
    ).not.toBeVisible();
    await expect(page.getByText(MEMBER_EMAIL)).toBeVisible();
  });

  await test.step("assign them to the crew and confirm it persists", async () => {
    const crewSelect = page.getByLabel(`Crew for ${MEMBER_EMAIL}`);
    await expect(crewSelect).toHaveValue("");

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" && res.url().endsWith("/app/team")
      ),
      crewSelect.selectOption({ label: CREW_NAME }),
    ]);
    expect(response.ok()).toBeTruthy();
    const crewId = await crewSelect.inputValue();
    expect(crewId).not.toBe("");

    await page.reload();
    await expect(page.getByLabel(`Crew for ${MEMBER_EMAIL}`)).toHaveValue(
      crewId
    );
  });
});

test("account: update own display name", async ({ page }) => {
  await page.goto("/account");
  originalOwnerName = await page.locator("#full_name").inputValue();

  await page.locator("#full_name").fill("E2E Owner Renamed");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Name updated.")).toBeVisible();

  await page.reload();
  await expect(page.locator("#full_name")).toHaveValue("E2E Owner Renamed");
});

test("org settings: update details and upload a logo", async ({ page }) => {
  await page.goto("/app/settings");

  await test.step("update name, address, and default working days", async () => {
    await page.locator("#org_name").fill("Handy Equip (E2E)");
    await page.locator("#org_address").fill("100 Test Way, QA City");
    // Add Saturday to the default working days.
    await page.getByRole("button", { name: "Sat", exact: true }).click();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();

    await page.reload();
    await expect(page.locator("#org_name")).toHaveValue("Handy Equip (E2E)");
    await expect(page.locator("#org_address")).toHaveValue(
      "100 Test Way, QA City"
    );

    // Confirmed against the DB directly, not just the button's rendered
    // style — a real persisted array, not just optimistic UI state.
    const admin = createAdminClient();
    const { data } = await admin
      .from("organizations")
      .select("default_working_days")
      .eq("id", originalOrg!.id)
      .single();
    expect(data?.default_working_days).toContain(6);
  });

  await test.step("upload a logo", async () => {
    // A tiny synthetic image via a throwaway page's own screenshot — no
    // binary fixture to commit, same technique as the packing-slip
    // extraction test's synthetic slip image.
    const logoPage = await page.context().newPage();
    await logoPage.setContent(
      `<html><body style="margin:0;width:200px;height:200px;background:#f2c00e;"></body></html>`
    );
    const buffer = await logoPage.screenshot();
    await logoPage.close();

    await page.locator('input[type="file"]').setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer,
    });
    await expect(
      page.getByRole("button", { name: "Replace logo" })
    ).toBeVisible({ timeout: 15_000 });
  });
});

test("role guard: crew user is redirected away from office/scheduler pages", async ({
  browser,
}) => {
  const admin = createAdminClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email: CREW_ROLE_EMAIL,
    password: CREW_ROLE_PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  crewRoleUserId = created.user.id;

  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .limit(1)
    .single();
  const { error: profileError } = await admin
    .from("profiles")
    .update({ org_id: org!.id, role: "crew" })
    .eq("id", crewRoleUserId);
  if (profileError) throw profileError;

  // A genuinely fresh, unauthenticated context — the default `page` fixture
  // in this project reuses the seeded owner's storageState, which would
  // defeat the point of testing as a different, lower-privileged user.
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/login");
  await page.getByLabel("Work email").fill(CREW_ROLE_EMAIL);
  await page.getByLabel("Password").fill(CREW_ROLE_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/app");

  for (const path of ["/scheduler", "/app/team", "/app/settings"]) {
    await page.goto(path);
    await page.waitForURL("/app");
  }

  const nav = page.locator("nav");
  await expect(
    nav.getByRole("link", { name: "Scheduler", exact: true })
  ).not.toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Team", exact: true })
  ).not.toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Settings", exact: true })
  ).not.toBeVisible();

  await context.close();
});
