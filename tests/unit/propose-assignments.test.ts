// Unit tests for the row-assignment split math (Batch 5 Sub-phase B(2)).
// Relative imports on purpose (node --test doesn't resolve "@/").
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAssignmentProposal,
  evenSplit,
  weightedSplit,
} from "../../lib/rows/propose-assignments.ts";

test("evenSplit distributes the remainder to the front and reconciles", () => {
  assert.deepEqual(evenSplit(12, 4), [3, 3, 3, 3]);
  assert.deepEqual(evenSplit(10, 4), [3, 3, 2, 2]);
  assert.deepEqual(evenSplit(0, 3), [0, 0, 0]);
  assert.deepEqual(evenSplit(5, 0), []);
  // Whatever the split, the parts always sum back to the total.
  const parts = evenSplit(97, 7);
  assert.equal(
    parts.reduce((a, b) => a + b, 0),
    97
  );
});

test("weightedSplit follows the weights and still reconciles exactly", () => {
  // 20 units, weights 3:1 → 15 and 5.
  assert.deepEqual(weightedSplit(20, [3, 1]), [15, 5]);
  // All-zero weights fall back to an even split.
  assert.deepEqual(weightedSplit(10, [0, 0]), [5, 5]);
  const parts = weightedSplit(101, [2, 5, 1]);
  assert.equal(
    parts.reduce((a, b) => a + b, 0),
    101
  );
});

test("buildAssignmentProposal even-splits every material across rows", () => {
  const { proposals, entries } = buildAssignmentProposal(
    [
      { materialId: "beam", name: "Beam", totalNeeded: 12 },
      { materialId: "anchor", name: "Anchor", totalNeeded: 10 },
    ],
    [
      { rowId: "r1", label: "Row 1" },
      { rowId: "r2", label: "Row 2" },
      { rowId: "r3", label: "Row 3" },
      { rowId: "r4", label: "Row 4" },
    ]
  );
  const beam = proposals.find((p) => p.materialId === "beam")!;
  assert.deepEqual(
    beam.perRow.map((c) => c.qty),
    [3, 3, 3, 3]
  );
  const anchor = proposals.find((p) => p.materialId === "anchor")!;
  assert.deepEqual(
    anchor.perRow.map((c) => c.qty),
    [3, 3, 2, 2]
  );
  // One entry per (material, row).
  assert.equal(entries.length, 8);
  // Every material's entries sum back to its total.
  const beamTotal = entries
    .filter((e) => e.materialId === "beam")
    .reduce((a, e) => a + e.requiredQty, 0);
  assert.equal(beamTotal, 12);
});

test("buildAssignmentProposal weights by bays when present", () => {
  const { proposals } = buildAssignmentProposal(
    [{ materialId: "beam", name: "Beam", totalNeeded: 20 }],
    [
      { rowId: "r1", label: "Row 1", bays: 3 },
      { rowId: "r2", label: "Row 2", bays: 1 },
    ]
  );
  assert.deepEqual(
    proposals[0].perRow.map((c) => c.qty),
    [15, 5]
  );
});
