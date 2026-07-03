import { expect, test } from "@playwright/test";

import { deleteAuthUserByEmail } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

// .test is IANA-reserved — can never collide with a real domain, same
// reasoning as the seeded owner account in scripts/seed.mjs.
const MEMBER_EMAIL = `e2e+team-${Date.now()}@handyequip.test`;

test.afterAll(async () => {
  await deleteAuthUserByEmail(MEMBER_EMAIL);
});

test("create team member, change role, reset password", async ({ page }) => {
  await test.step("create a team member with a temporary password", async () => {
    await page.goto("/app/team");
    await page.getByRole("button", { name: "+ Add team member" }).click();

    await page.locator("#email").fill(MEMBER_EMAIL);
    await page.locator("#full_name").fill("E2E Team Member");
    await page.locator("#role").selectOption("scheduler");

    // The dialog auto-fills a generated temporary password — confirm it's
    // non-trivial rather than replacing it, exercising the real default path.
    const passwordValue = await page.locator("#password").inputValue();
    expect(passwordValue.length).toBeGreaterThanOrEqual(8);

    await page.getByRole("button", { name: "Create account" }).click();
    // "+ Add team member" (the trigger button, always on the page) contains
    // "Add team member" as a substring, so assert on the submit button
    // instead — it only exists while the dialog is open.
    await expect(
      page.getByRole("button", { name: "Create account" })
    ).not.toBeVisible();

    await expect(page.getByText("E2E Team Member")).toBeVisible();
    await expect(page.getByText(MEMBER_EMAIL)).toBeVisible();
  });

  await test.step("change their role", async () => {
    const roleSelect = page.getByLabel(`Role for ${MEMBER_EMAIL}`);
    await expect(roleSelect).toHaveValue("scheduler");

    // The row updates its select optimistically (setRole before the
    // Server Action resolves), so checking the DOM value alone doesn't
    // prove the change persisted — wait for the actual POST response, or a
    // reload immediately after could race an in-flight/cancelled request.
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" && res.url().endsWith("/app/team")
      ),
      roleSelect.selectOption("crew"),
    ]);
    expect(response.ok()).toBeTruthy();

    await page.reload();
    await expect(page.getByLabel(`Role for ${MEMBER_EMAIL}`)).toHaveValue(
      "crew"
    );
  });

  await test.step("reset their password", async () => {
    const row = page.getByTestId(`team-member-row-${MEMBER_EMAIL}`);

    await row.getByRole("button", { name: "Reset password" }).click();
    const newPasswordInput = row.getByLabel("New temporary password");
    await expect(newPasswordInput).not.toHaveValue("");

    await row.getByRole("button", { name: "Save" }).click();
    await expect(
      row.getByRole("button", { name: "Reset password" })
    ).toBeVisible();
  });

  await test.step("deactivate then reactivate the member", async () => {
    const row = page.getByTestId(`team-member-row-${MEMBER_EMAIL}`);
    await expect(row.getByText("Active", { exact: true })).toBeVisible();

    const [deactivateResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" && res.url().endsWith("/app/team")
      ),
      row.getByRole("button", { name: "Deactivate" }).click(),
    ]);
    expect(deactivateResponse.ok()).toBeTruthy();
    await expect(row.getByText("Deactivated", { exact: true })).toBeVisible();

    const admin = createAdminClient();
    const { data: afterDeactivate, error: deactivateError } =
      await admin.auth.admin.listUsers();
    if (deactivateError) throw deactivateError;
    const deactivatedUser = afterDeactivate.users.find(
      (u) => u.email === MEMBER_EMAIL
    );
    expect(deactivatedUser).toBeTruthy();
    expect(
      deactivatedUser!.banned_until &&
        new Date(deactivatedUser!.banned_until).getTime() > Date.now()
    ).toBe(true);

    const [reactivateResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" && res.url().endsWith("/app/team")
      ),
      row.getByRole("button", { name: "Reactivate" }).click(),
    ]);
    expect(reactivateResponse.ok()).toBeTruthy();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();

    const { data: afterReactivate, error: reactivateError } =
      await admin.auth.admin.listUsers();
    if (reactivateError) throw reactivateError;
    const reactivatedUser = afterReactivate.users.find(
      (u) => u.email === MEMBER_EMAIL
    );
    const stillBanned =
      reactivatedUser?.banned_until &&
      new Date(reactivatedUser.banned_until).getTime() > Date.now();
    expect(stillBanned).toBeFalsy();
  });
});

test("self-service change password from the Account page", async ({ page }) => {
  // Whatever this sets the seeded owner's password to is harmless beyond
  // this run — scripts/seed.mjs resets it to a known value on every
  // subsequent `npm run test:e2e`, so this can't break future runs.
  await page.goto("/account");
  await page.locator("#new_password").fill("e2e-rotated-password-2!");
  await page.locator("#confirm_password").fill("e2e-rotated-password-2!");
  await page.getByRole("button", { name: "Update password" }).click();

  await expect(page.getByText("Password updated.")).toBeVisible();
});
