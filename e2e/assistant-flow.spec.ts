import { expect, test } from "@playwright/test";

import { deleteProjectCompletely } from "./helpers/cleanup";
import { createAdminClient } from "./helpers/supabase-admin";

// Batch 5 Sub-phase E: the read-only NL assistant. Asks a real question,
// the model tool-calls the RLS-scoped query functions and answers citing
// the data with a "show me" link. Needs a live ANTHROPIC_API_KEY.

const STAMP = Date.now();
const PROJECT_NAME = `[E2E] Ask ${STAMP}`;
let projectId: string | null = null;

test.afterAll(async () => {
  if (projectId) await deleteProjectCompletely(projectId);
});

test("assistant: not configured → clear message", async ({ page }) => {
  test.skip(
    Boolean(process.env.ANTHROPIC_API_KEY),
    "only when no ANTHROPIC_API_KEY is set"
  );
  await page.goto("/app");
  await page.getByTestId("assistant-open").click();
  await page.getByTestId("assistant-input").fill("how many projects?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByText(/isn't configured/i)).toBeVisible({
    timeout: 15_000,
  });
});

test("assistant: answers a data question with a show-me link", async ({
  page,
}) => {
  test.skip(
    !process.env.ANTHROPIC_API_KEY,
    "needs a real ANTHROPIC_API_KEY for the live tool-calling loop"
  );
  test.setTimeout(90_000);

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .limit(1)
    .single();
  const { data: project, error } = await admin
    .from("projects")
    .insert({ org_id: org!.id, name: PROJECT_NAME, status: "on_hold" })
    .select("id")
    .single();
  if (error) throw error;
  projectId = project.id;

  await page.goto("/app");
  await page.getByTestId("assistant-open").click();
  await page
    .getByTestId("assistant-input")
    .fill(`What is the status of ${PROJECT_NAME}?`);
  await page.getByRole("button", { name: "Ask" }).click();

  // The answer should mention the project is on hold (from project_status),
  // and offer a "show me" link into that project.
  const answer = page.getByTestId("assistant-answer");
  await expect(answer).toBeVisible({ timeout: 60_000 });
  await expect(answer).toContainText(/hold/i);
  await expect(
    page.getByRole("link", { name: new RegExp(PROJECT_NAME.replace(/[[\]]/g, "\\$&")) })
  ).toBeVisible();
});
