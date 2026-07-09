// Unit tests for the anomaly rules (Batch 5 Sub-phase D). Pure, so fully
// unit-testable. Relative imports (node --test doesn't resolve "@/").
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_THRESHOLDS,
  detectAllAnomalies,
  detectIdleCrew,
  detectLowOutput,
  detectShortfalls,
  detectSpiAnomalies,
  resolveThresholds,
} from "../../lib/anomalies/detect.ts";

const T = DEFAULT_THRESHOLDS;

test("SPI: flags risk (warn) and critical, ignores healthy + unknown", () => {
  const out = detectSpiAnomalies(
    [
      { projectId: "p1", projectName: "A", spi: 0.75 },
      { projectId: "p2", projectName: "B", spi: 0.55 },
      { projectId: "p3", projectName: "C", spi: 1.1 },
      { projectId: "p4", projectName: "D", spi: null },
    ],
    T
  );
  assert.equal(out.length, 2);
  assert.equal(out.find((a) => a.projectId === "p1")!.severity, "warn");
  assert.equal(out.find((a) => a.projectId === "p2")!.severity, "critical");
});

test("low output: flags below-norm days but excuses blockers + tiny norms", () => {
  const out = detectLowOutput(
    [
      // 2 of ~10/day, no blocker → flagged
      { crewId: "c1", crewName: "Crew 1", projectId: "p1", workDate: "2026-07-06", output: 2, norm: 10, hadBlocker: false },
      // low, but a blocker was logged → excused
      { crewId: "c1", crewName: "Crew 1", projectId: "p1", workDate: "2026-07-07", output: 1, norm: 10, hadBlocker: true },
      // healthy day → not flagged
      { crewId: "c1", crewName: "Crew 1", projectId: "p1", workDate: "2026-07-08", output: 9, norm: 10, hadBlocker: false },
      // tiny norm (below minSampleUnits) → skipped, not enough signal
      { crewId: "c2", crewName: "Crew 2", projectId: "p1", workDate: "2026-07-08", output: 0, norm: 2, hadBlocker: false },
    ],
    T
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].dedupeKey, "low_output:c1:2026-07-06");
});

test("shortfall: flags only within the lead-day window, critical when due", () => {
  const out = detectShortfalls(
    [
      { projectId: "p1", projectName: "A", materialId: "m1", materialName: "Beam", toOrder: 40, leadDays: 3 },
      { projectId: "p1", projectName: "A", materialId: "m2", materialName: "Anchor", toOrder: 10, leadDays: 0 },
      { projectId: "p1", projectName: "A", materialId: "m3", materialName: "Deck", toOrder: 5, leadDays: 30 },
      { projectId: "p1", projectName: "A", materialId: "m4", materialName: "Nut", toOrder: 0, leadDays: 1 },
    ],
    T
  );
  assert.equal(out.length, 2);
  assert.equal(out.find((a) => a.payload.materialId === "m2")!.severity, "critical");
});

test("idle crew: only unexplained zero-output scheduled days", () => {
  const out = detectIdleCrew([
    { crewId: "c1", crewName: "Crew 1", projectId: "p1", projectName: "A", workDate: "2026-07-06", output: 0, hadDayLog: false, hadBlocker: false },
    { crewId: "c1", crewName: "Crew 1", projectId: "p1", projectName: "A", workDate: "2026-07-07", output: 0, hadDayLog: true, hadBlocker: false },
    { crewId: "c1", crewName: "Crew 1", projectId: "p1", projectName: "A", workDate: "2026-07-08", output: 5, hadDayLog: false, hadBlocker: false },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].dedupeKey, "idle_crew:c1:2026-07-06");
});

test("detectAllAnomalies dedupes by key and merges every rule", () => {
  const out = detectAllAnomalies(
    {
      spi: [{ projectId: "p1", projectName: "A", spi: 0.5 }],
      crewDays: [
        { crewId: "c1", crewName: "Crew 1", projectId: "p1", workDate: "2026-07-06", output: 0, norm: 10, hadBlocker: false },
      ],
      shortfalls: [
        { projectId: "p1", projectName: "A", materialId: "m1", materialName: "Beam", toOrder: 20, leadDays: 2 },
      ],
      idle: [
        { crewId: "c2", crewName: "Crew 2", projectId: "p1", projectName: "A", workDate: "2026-07-06", output: 0, hadDayLog: false, hadBlocker: false },
      ],
    },
    T
  );
  const keys = out.map((a) => a.dedupeKey).sort();
  assert.deepEqual(keys, [
    "idle_crew:c2:2026-07-06",
    "low_output:c1:2026-07-06",
    "material_shortfall:p1:m1",
    "spi_slipping:p1",
  ]);
});

test("resolveThresholds merges overrides onto defaults", () => {
  assert.equal(resolveThresholds({ spiRisk: 0.9 }).spiRisk, 0.9);
  assert.equal(resolveThresholds({ spiRisk: 0.9 }).spiCritical, T.spiCritical);
  assert.equal(resolveThresholds(null).lowOutputFraction, T.lowOutputFraction);
});
