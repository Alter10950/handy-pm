// Unit + regression tests for the estimate engine (Phase 13.3) — run via
// `npm run test:unit` (node --test with native type stripping, Node 24).
// Relative import on purpose: node --test doesn't resolve the "@/" alias.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeCrewDays,
  computeLine,
  computeProjectLines,
  inchesToFeet,
  resolveStandard,
  standardWarnings,
} from "../../lib/estimating/engine.ts";

test("REGRESSION: the inches-as-feet path is gone — a 144\" beam is 12 ft and its labor is per-piece, not 7.2h", () => {
  assert.equal(inchesToFeet(144), 12);
  const line = computeLine({
    skuId: "beam-144",
    name: '144"x6" stepbeam',
    attrs: { category: "beam", lengthIn: 144 },
    quantity: 1,
    installedQuantity: 0,
    categoryDefault: 0.08,
  });
  // Old bug: 144 (inches read as feet) × 0.05 = 7.2 h per beam.
  assert.ok(line.hoursPerUnit < 0.5, `beam h/unit ${line.hoursPerUnit} must be per-piece scale`);
  assert.ok(Math.abs(line.hoursPerUnit - 0.08 * 1.15) < 1e-9); // 97–144in band
  assert.notEqual(line.hoursPerUnit, 7.2);
  assert.equal(line.warnings.length, 0);
});

test("96\" beam takes the base band; >144\" takes the long band", () => {
  const short = computeLine({
    skuId: null,
    name: '96" beam',
    attrs: { category: "beam", lengthIn: 96 },
    quantity: 10,
    installedQuantity: 0,
    categoryDefault: 0.08,
  });
  assert.equal(short.hoursPerUnit, 0.08);
  const long = computeLine({
    skuId: null,
    name: '168" beam',
    attrs: { category: "beam", lengthIn: 168 },
    quantity: 10,
    installedQuantity: 0,
    categoryDefault: 0.08,
  });
  assert.ok(Math.abs(long.hoursPerUnit - 0.08 * 1.3) < 1e-9);
});

test("upright height bands + lift surcharge stack; per-SKU standard bypasses modifiers", () => {
  const tall = resolveStandard({
    attrs: { category: "upright", heightIn: 288, requiresLift: true },
    categoryDefault: 0.25,
  });
  assert.ok(Math.abs(tall.hoursPerUnit - 0.25 * 1.4 * 1.25) < 1e-9);
  assert.equal(tall.source, "category");
  assert.deepEqual(tall.modifiers, ["height >192in ×1.4", "lift required ×1.25"]);

  const skuOverride = resolveStandard({
    attrs: { category: "upright", heightIn: 288, requiresLift: true },
    skuStandard: 0.4,
    categoryDefault: 0.25,
  });
  assert.equal(skuOverride.hoursPerUnit, 0.4); // used as-is, no modifiers
  assert.equal(skuOverride.source, "sku");
});

test("precedence: learned crew×SKU rate outranks standards once it has samples", () => {
  const resolved = resolveStandard({
    attrs: { category: "beam", lengthIn: 144 },
    learned: { hoursPerUnit: 0.06, samples: 5 },
    skuStandard: 0.1,
    categoryDefault: 0.08,
  });
  assert.equal(resolved.source, "learned");
  assert.equal(resolved.hoursPerUnit, 0.06);

  const tooFewSamples = resolveStandard({
    attrs: { category: "beam", lengthIn: 144 },
    learned: { hoursPerUnit: 0.06, samples: 1 },
    skuStandard: 0.1,
    categoryDefault: 0.08,
  });
  assert.equal(tooFewSamples.source, "sku");
});

test("guardrails: implausible standards and forecasts warn loudly", () => {
  assert.equal(standardWarnings("beam", 0.4).length, 0);
  assert.equal(standardWarnings("beam", 7.2).length, 1); // the old bug's number
  const { warnings } = computeCrewDays({
    remainingHours: 25_268, // the live app's broken "Full scope"
    crewSize: 3,
    shiftHours: 8,
  });
  assert.equal(warnings.length, 1);
});

test("SANITY: a Bingo-Warehouse-scale job (≈700 uprights + ≈3,700 beams) lands in a believable crew-day range", () => {
  const project = computeProjectLines([
    {
      skuId: "u1",
      name: '42"x24\' upright',
      attrs: { category: "upright", heightIn: 288, requiresLift: true },
      quantity: 700,
      installedQuantity: 0,
      categoryDefault: 0.25,
    },
    {
      skuId: "b1",
      name: '144" stepbeam',
      attrs: { category: "beam", lengthIn: 144 },
      quantity: 2200,
      installedQuantity: 0,
      categoryDefault: 0.08,
    },
    {
      skuId: "b2",
      name: '96" stepbeam',
      attrs: { category: "beam", lengthIn: 96 },
      quantity: 1500,
      installedQuantity: 0,
      categoryDefault: 0.08,
    },
    {
      skuId: "w1",
      name: '42"x46" wire deck',
      attrs: { category: "wire_deck" },
      quantity: 3000,
      installedQuantity: 0,
      categoryDefault: 0.03,
    },
    {
      skuId: "a1",
      name: '1/2" wedge anchor',
      attrs: { category: "anchor" },
      quantity: 2800,
      installedQuantity: 0,
      categoryDefault: 0.05,
    },
  ]);

  // Old engine said 25,268 hours / finish in 2036. The corrected model
  // must land a real-world figure: several hundred to ~1.5k hours.
  assert.ok(
    project.totalHours > 300 && project.totalHours < 1500,
    `total hours ${project.totalHours} out of believable range`
  );
  assert.equal(project.warnings.length, 0);

  const { crewDays, warnings } = computeCrewDays({
    remainingHours: project.remainingHours,
    crewSize: 3,
    shiftHours: 8,
    efficiency: 0.85,
  });
  assert.ok(
    crewDays > 15 && crewDays < 120,
    `crew-days ${crewDays} out of believable range (weeks, not years)`
  );
  assert.equal(warnings.length, 0);
});

test("remaining hours track installed quantities per line", () => {
  const line = computeLine({
    skuId: "b1",
    name: "beam",
    attrs: { category: "beam", lengthIn: 96 },
    quantity: 100,
    installedQuantity: 40,
    categoryDefault: 0.08,
  });
  assert.equal(line.totalHours, 8);
  assert.equal(line.remainingHours, round2(60 * 0.08));
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
