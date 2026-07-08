// Unit tests for the SKU parser (Phase 13.1) — backfill-time only.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyCategory,
  extractSizeFromName,
  parseSizeText,
  requiresLift,
} from "../../lib/skus/parse.ts";

test("category classification: real Handy Equip material names", () => {
  assert.equal(classifyCategory('144"x6" Stepbeam'), "beam");
  assert.equal(classifyCategory("Teardrop Upright 42x288"), "upright");
  assert.equal(classifyCategory("Wire Deck 42x46"), "wire_deck");
  assert.equal(classifyCategory("Row Spacer 12in"), "row_spacer");
  assert.equal(classifyCategory('1/2" x 3-3/4" Wedge Anchor'), "anchor");
  assert.equal(classifyCategory("Post Protector"), "post_protector");
  assert.equal(classifyCategory("End of Aisle Barrier"), "end_barrier");
  assert.equal(classifyCategory("Footplate"), "footplate");
  assert.equal(classifyCategory("Shim Pack"), "shim");
  assert.equal(classifyCategory("Pallet Support Bar"), "accessory");
  assert.equal(classifyCategory("Mystery Item 9000"), "other");
});

test('UNIT SEMANTICS: 42"x24\' upright → depth 42 in, height 288 in (feet marked explicitly)', () => {
  const attrs = parseSizeText("upright", `42"x24'`);
  assert.equal(attrs.depthIn, 42);
  assert.equal(attrs.heightIn, 288);
  assert.equal(attrs.needsReview, false);
});

test("bare numbers are INCHES (the historical bug treated them as feet)", () => {
  const beam = parseSizeText("beam", "144x6");
  assert.equal(beam.lengthIn, 144); // 12 ft — not 144 ft
  assert.equal(beam.widthIn, 6);

  const deck = parseSizeText("wire_deck", "42x46");
  assert.equal(deck.depthIn, 42);
  assert.equal(deck.widthIn, 46);
});

test("upright with swapped order still lands height as the larger figure", () => {
  const attrs = parseSizeText("upright", `288"x42"`);
  assert.equal(attrs.heightIn, 288);
  assert.equal(attrs.depthIn, 42);
});

test("dimensioned categories without a parseable size flag needsReview; anchors don't", () => {
  assert.equal(parseSizeText("beam", "").needsReview, true);
  assert.equal(parseSizeText("upright", "tall-ish").needsReview, true);
  assert.equal(parseSizeText("anchor", "").needsReview, false);
  // Anchor fraction sizes aren't dimensions we model — and never flag.
  assert.equal(parseSizeText("anchor", '1/2" x 3-3/4"').needsReview, false);
});

test("ft/in word units parse", () => {
  assert.equal(parseSizeText("beam", "8ft").lengthIn, 96);
  assert.equal(parseSizeText("beam", "96in").lengthIn, 96);
});

test("lift threshold at 16 ft (192 in)", () => {
  assert.equal(requiresLift(191), false);
  assert.equal(requiresLift(192), true);
  assert.equal(requiresLift(null), false);
});

test("size extraction from NAMES (pasted BOMs put dims in the name)", () => {
  assert.equal(extractSizeFromName('144"x6" Stepbeam'), '144"x6"');
  assert.equal(extractSizeFromName('42"x288" Teardrop Upright'), '42"x288"');
  assert.equal(extractSizeFromName("Wire Deck 42x46"), "42x46");
  assert.equal(extractSizeFromName("8ft Beam"), "8ft");
  // Anchor fractions are NOT dimensions.
  assert.equal(extractSizeFromName('1/2" Wedge Anchor'), null);
  assert.equal(extractSizeFromName("Post Protector"), null);

  // End-to-end: a pasted beam line engages the long-length modifier.
  const attrs = parseSizeText("beam", extractSizeFromName('168" Stepbeam'));
  assert.equal(attrs.lengthIn, 168);
});
