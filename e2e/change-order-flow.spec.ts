import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

const PROJECT_NAME = `[E2E] Change orders ${Date.now()}`;

let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("change orders: draft with lines, manual approval merges scope+materials and snapshots the baseline, tokenized customer approval works unauthenticated, scope-growth banner fires", async ({
  page,
  browser,
}) => {
  const admin = createAdminClient();
  test.setTimeout(150_000);

  await test.step("create a project with a small BOM", async () => {
    await page.goto("/app");
    await page.getByRole("button", { name: "+ New project" }).click();
    await page.locator("#name").fill(PROJECT_NAME);
    await page.getByRole("button", { name: "Create project" }).click();
    await page.waitForURL(/\/app\/project\/[^/]+$/);
    projectId = /\/app\/project\/([^/]+)$/.exec(page.url())![1];

    await page.getByRole("link", { name: "Materials" }).click();
    await page
      .getByRole("button", { name: /Paste from packing slip/i })
      .click();
    await page.locator("textarea").fill("Beam, 10");
    await page.getByRole("button", { name: "Add materials" }).click();
    await expect(page.locator("table").first().locator("tbody tr")).toHaveCount(
      1
    );
  });

  await test.step("create CO-1 as a draft", async () => {
    await page.getByRole("link", { name: "COs" }).click();
    await page.getByRole("button", { name: "+ New change order" }).click();
    await page.locator("#co-title").fill("Add teardown along north wall");
    await page.locator("#co-reason").selectOption("scope_missed");
    await page
      .locator("#co-description")
      .fill("Existing racking on the north wall must come down first.");
    await page.getByRole("button", { name: "Create change order" }).click();

    await page.waitForURL(/\/change-orders\/[^/]+$/);
    await expect(page.getByText("CO-1", { exact: true })).toBeVisible();
    await expect(page.getByTestId("co-status-badge")).toHaveText("Draft");
  });

  await test.step("add a scope line and a material line — labor and days auto-suggest", async () => {
    // Scope line: teardown, qty 4 → seeded 0.15 base units × 4 = 0.6 hrs.
    await page.getByLabel("Work type").selectOption("teardown");
    await page.getByLabel("Line description").fill("Tear down north wall run");
    await page.getByLabel("Line quantity").fill("4");
    await page.getByLabel("Line unit").fill("sections");
    await page.getByRole("button", { name: "+ Add line" }).click();
    await expect(page.getByTestId("co-line-list").locator("li")).toHaveCount(1);

    // Material line.
    await page.getByRole("button", { name: "Material", exact: true }).click();
    await page.getByLabel("Line description").fill("Extra Upright");
    await page.getByLabel("Line quantity").fill("6");
    await page.getByLabel("Line unit").fill("pcs");
    await page.getByRole("button", { name: "+ Add line" }).click();
    await expect(page.getByTestId("co-line-list").locator("li")).toHaveCount(2);

    // Auto-suggested totals: teardown 0.15×4 = 0.6 + material at the
    // "general" standard 0.1/unit × 6 = 0.6 → 1.2 hrs; added days =
    // 1.2 / 8 = 0.15.
    await expect(page.locator("#co-labor")).toHaveValue("1.2");
    await expect(page.locator("#co-days")).toHaveValue("0.15");

    await page.locator("#co-price").fill("1500");
    await page.locator("#co-price").blur();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("change_orders")
          .select("price")
          .eq("project_id", projectId!)
          .eq("number", 1)
          .single();
        return data?.price;
      })
      .toBe(1500);
  });

  await test.step("manual approval merges the lines and snapshots the original estimate", async () => {
    const { data: before } = await admin
      .from("projects")
      .select("original_estimate_saved_at")
      .eq("id", projectId!)
      .single();
    expect(before!.original_estimate_saved_at).toBeNull();

    await page
      .getByRole("button", { name: "Record approval manually" })
      .click();
    await page.getByLabel("Approval channel").selectOption("verbal");
    await page.getByLabel("Approver name").fill("Pat Customer");
    await page.getByRole("button", { name: "Record approval" }).click();

    await expect(page.getByTestId("co-status-badge")).toHaveText("Approved", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("co-approved-line")).toContainText(
      "Pat Customer"
    );

    // Scope line became a real scope item.
    const { data: scopeItems } = await admin
      .from("scope_items")
      .select("work_type, description, labor_units, source, change_order_id")
      .eq("project_id", projectId!)
      .eq("source", "change_order");
    expect(scopeItems).toHaveLength(1);
    expect(scopeItems![0].work_type).toBe("teardown");
    expect(scopeItems![0].labor_units).toBe(0.6);
    expect(scopeItems![0].change_order_id).not.toBeNull();

    // Material line became a real material — received 0 (still has to
    // clear the Sub-phase E gate), per-unit labor back-derived from the
    // stored line total (0.6 / 6 = 0.1).
    const { data: coMaterial } = await admin
      .from("materials")
      .select("name, total_needed, received, labor_units, change_order_id")
      .eq("project_id", projectId!)
      .eq("name", "Extra Upright")
      .single();
    expect(coMaterial!.total_needed).toBe(6);
    expect(coMaterial!.received).toBe(0);
    expect(coMaterial!.labor_units).toBe(0.1);
    expect(coMaterial!.change_order_id).not.toBeNull();

    // Baseline snapshotted before the merge — original excludes CO work.
    const { data: after } = await admin
      .from("projects")
      .select(
        "original_estimate_saved_at, original_estimate_labor_units, original_estimate_days"
      )
      .eq("id", projectId!)
      .single();
    expect(after!.original_estimate_saved_at).not.toBeNull();
    // Original BOM: 10 Beams — Phase 13 classifies from the NAME, so each
    // books the beam per-piece standard (0.08 h) = 0.8 hours, NOT the old
    // blanket-'general' 1.0. Excludes the CO's own 1.2.
    expect(after!.original_estimate_labor_units).toBe(0.8);
  });

  await test.step("estimate tab shows original vs current approved", async () => {
    await page.goto(`/app/project/${projectId}/estimate`);
    const card = page.getByTestId("estimate-baseline-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("1 approved change order");
    // Approved hours = original 0.8 + CO 1.2 = 2, rendered with the delta.
    await expect(card).toContainText("2");
    await expect(card).toContainText("(+1.2)");
  });

  await test.step("CO-2: send for customer approval mints a token and logs the comms row", async () => {
    await page.goto(`/app/project/${projectId}/change-orders`);
    await page.getByRole("button", { name: "+ New change order" }).click();
    await page.locator("#co-title").fill("Second change for email approval");
    await page.getByRole("button", { name: "Create change order" }).click();
    await page.waitForURL(/\/change-orders\/[^/]+$/);
    await expect(page.getByText("CO-2", { exact: true })).toBeVisible();

    await page.getByLabel("Customer email").fill("delivered@resend.dev");
    await page.getByRole("button", { name: "Save email" }).click();
    await expect(page.getByText("Customer email saved.")).toBeVisible();
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(
      page.getByText(/Sent — the customer has the approval link/)
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("co-status-badge")).toHaveText(
      "Pending customer"
    );

    const { data: co2 } = await admin
      .from("change_orders")
      .select("approval_token, sent_to, status")
      .eq("project_id", projectId!)
      .eq("number", 2)
      .single();
    expect(co2!.status).toBe("pending_customer");
    expect(co2!.approval_token).toBeTruthy();
    expect(co2!.sent_to).toBe("delivered@resend.dev");

    const { data: comms } = await admin
      .from("project_comms")
      .select("kind, channel, recipient")
      .eq("project_id", projectId!)
      .eq("kind", "change_order");
    expect(comms).toHaveLength(1);
    expect(comms![0].channel).toBe("email");
    expect(comms![0].recipient).toBe("delivered@resend.dev");
  });

  await test.step("the customer approves CO-2 from the public page — genuinely unauthenticated", async () => {
    const { data: co2 } = await admin
      .from("change_orders")
      .select("approval_token")
      .eq("project_id", projectId!)
      .eq("number", 2)
      .single();

    // A brand-new context with no storageState — no session cookies at
    // all, exactly like the customer clicking the emailed link.
    const publicContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`/portal/co/${co2!.approval_token}`);
    await expect(
      publicPage.getByText("Second change for email approval")
    ).toBeVisible();

    await publicPage.locator("#approver-name").fill("Casey Customer");
    await publicPage
      .getByRole("button", { name: "Approve this change" })
      .click();
    await expect(publicPage.getByTestId("co-decision-done")).toContainText(
      "Approved — thank you!"
    );
    await publicContext.close();

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("change_orders")
          .select(
            "status, approval_token, customer_approver_name, customer_approved_via"
          )
          .eq("project_id", projectId!)
          .eq("number", 2)
          .single();
        return data;
      })
      .toMatchObject({
        status: "approved",
        approval_token: null,
        customer_approver_name: "Casey Customer",
        customer_approved_via: "email_link",
      });
  });

  await test.step("CO-3 declined via the public page", async () => {
    await page.goto(`/app/project/${projectId}/change-orders`);
    await page.getByRole("button", { name: "+ New change order" }).click();
    await page.locator("#co-title").fill("Third change the customer declines");
    await page.getByRole("button", { name: "Create change order" }).click();
    await page.waitForURL(/\/change-orders\/[^/]+$/);
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(page.getByTestId("co-status-badge")).toHaveText(
      "Pending customer",
      {
        timeout: 20_000,
      }
    );

    const { data: co3 } = await admin
      .from("change_orders")
      .select("approval_token")
      .eq("project_id", projectId!)
      .eq("number", 3)
      .single();

    const publicContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`/portal/co/${co3!.approval_token}`);
    await publicPage.getByRole("button", { name: "Decline…" }).click();
    await publicPage
      .locator("#decline-note")
      .fill("Budget's spent for this quarter");
    await publicPage
      .getByRole("button", { name: "Decline this change" })
      .click();
    await expect(publicPage.getByTestId("co-decision-done")).toContainText(
      "Declined"
    );
    await publicContext.close();

    const { data: after } = await admin
      .from("change_orders")
      .select("status, description")
      .eq("project_id", projectId!)
      .eq("number", 3)
      .single();
    expect(after!.status).toBe("rejected");
    expect(after!.description).toContain("Budget's spent");

    // Declined CO merged nothing.
    const { data: scopeItems } = await admin
      .from("scope_items")
      .select("id")
      .eq("project_id", projectId!)
      .eq("source", "change_order");
    expect(scopeItems).toHaveLength(1); // still only CO-1's
  });

  await test.step("a decided token is dead — replaying it can't flip anything", async () => {
    const publicContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const publicPage = await publicContext.newPage();
    // CO-2's token was nulled at approval; any old value now 404-shells.
    const { data: co2 } = await admin
      .from("change_orders")
      .select("approval_token")
      .eq("project_id", projectId!)
      .eq("number", 2)
      .single();
    expect(co2!.approval_token).toBeNull();
    await publicPage.goto(`/portal/co/deadbeefdeadbeefdeadbeefdeadbeef`);
    await expect(
      publicPage.getByText("This link is no longer valid")
    ).toBeVisible();
    await publicContext.close();
  });

  await test.step("closeout PDF includes the change orders", async () => {
    const response = await page.request.get(
      `/api/projects/${projectId}/closeout-pdf`
    );
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toBe("application/pdf");
  });

  await test.step("scope-growth banner: a material added mid-execute with no CO prompts for one", async () => {
    // Fast-forward the lifecycle to Execute with a completed Mobilize.
    const now = new Date().toISOString();
    await admin
      .from("project_stages")
      .update({ status: "complete", completed_at: now })
      .eq("project_id", projectId!)
      .in("stage_key", [
        "handoff",
        "scope",
        "schedule",
        "materials",
        "mobilize",
      ]);
    await admin
      .from("project_stages")
      .update({ status: "active" })
      .eq("project_id", projectId!)
      .eq("stage_key", "execute");
    await admin
      .from("projects")
      .update({ stage_key: "execute" })
      .eq("id", projectId!);

    // CO-1's merged material was created BEFORE mobilize completed, so it
    // doesn't count; a fresh no-CO material added now does.
    await page.goto(`/app/project/${projectId}/materials`);
    await expect(page.getByTestId("scope-growth-banner")).toHaveCount(0);

    // The grid's "+ Add material" button inserts a material named
    // "New part" directly — confirm in the DB (the grid cell is an
    // <input>, whose value isn't in the DOM text).
    await page.getByRole("button", { name: "+ Add material" }).click();
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("materials")
          .select("id")
          .eq("project_id", projectId!)
          .eq("name", "New part");
        return data?.length ?? 0;
      })
      .toBe(1);

    await page.reload();
    const banner = page.getByTestId("scope-growth-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("1 material added mid-execution");
    await expect(
      banner.getByRole("link", { name: "Create a change order?" })
    ).toBeVisible();
  });
});
