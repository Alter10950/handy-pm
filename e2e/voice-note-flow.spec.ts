import { expect, test } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT) || 3001;
const BASE_URL = `http://localhost:${PORT}`;

// The Web Speech API's SpeechRecognition can't be driven in headless
// Chromium the way a real device's microphone can, so the client-side
// recording button isn't E2E-testable end to end — see
// components/field/voice-note-recorder.tsx and docs/DECISIONS.md
// ADR-028. What *is* testable, and where the actual AI-parsing logic
// lives, is the route it calls once a transcript exists — tested here the
// same way as the packing-slip extraction route: skipped without a real
// ANTHROPIC_API_KEY, exercised live when one is configured.

test("voice note API: clear error when not configured", async ({ request }) => {
  test.skip(
    Boolean(process.env.ANTHROPIC_API_KEY),
    "only relevant when no ANTHROPIC_API_KEY is configured"
  );

  // The `request` fixture inherits this project's storageState (the
  // seeded owner's session) from playwright.config.ts, so this exercises
  // the real "signed in, but no key configured" path, not "signed out."
  const response = await request.post("/api/field/voice-note", {
    data: { transcript: "test transcript" },
  });
  expect(response.status()).toBe(500);
  const body = await response.json();
  expect(body.error).toContain("ANTHROPIC_API_KEY is not configured");
});

test("voice note API: rejects an unauthenticated request", async () => {
  // Plain Node fetch(), not Playwright's request fixture/module — both
  // `browser.newContext()` and `request.newContext()` were empirically
  // observed carrying *some* valid session through to the server here
  // (confirmed via a real, cookie-less `curl` to the same running
  // server immediately after, which correctly got 401 — so the
  // server-side guard itself is sound; this is specifically a
  // Playwright request-context quirk, not a security bug). A bare
  // fetch() has no ambient cookie jar or storageState of any kind.
  const response = await fetch(`${BASE_URL}/api/field/voice-note`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transcript: "test transcript" }),
  });
  expect(response.status).toBe(401);
});

test("voice note API: cleans up a transcript and flags a blocker", async ({
  request,
}) => {
  test.skip(
    !process.env.ANTHROPIC_API_KEY,
    "needs a real ANTHROPIC_API_KEY to call the live API"
  );

  const response = await request.post("/api/field/voice-note", {
    data: {
      transcript:
        "uh so row three we got um twelve beams in today but uh we're " +
        "actually out of anchors so we had to stop until more show up",
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();

  expect(typeof body.cleanedNote).toBe("string");
  expect(body.cleanedNote.length).toBeGreaterThan(0);
  expect(body.cleanedNote.toLowerCase()).not.toContain("uh");
  expect(body.isBlocker).toBe(true);
  expect(body.blockerCode).toBe("MISSING_MATERIAL");
});
