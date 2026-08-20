import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reviewDraftKey,
  parseStoredReview,
  serializeReview,
  isFresh,
} from './review-draft.ts';

const NOW = new Date("2026-08-19T18:00:00Z");

const sample = {
  rows: [{ employeeId: "e1", st: 8, ot: 2 }],
  summary: "Pulled feeders on three.",
  unmatched: [] as string[],
  draft: { workPerformed: "Pulled feeders on three." },
  photos: [{ documentId: "doc-1", page: 1 }],
  step: "summary",
};

test("two jobs on the same afternoon do not overwrite each other", () => {
  assert.notEqual(
    reviewDraftKey("job-a", "2026-08-19"),
    reviewDraftKey("job-b", "2026-08-19"),
  );
  // Nor does the same job on two days.
  assert.notEqual(
    reviewDraftKey("job-a", "2026-08-19"),
    reviewDraftKey("job-a", "2026-08-20"),
  );
});

test("a review survives the round trip", () => {
  const back = parseStoredReview(serializeReview(sample, NOW));
  assert.ok(back);
  assert.equal(back!.summary, sample.summary);
  assert.equal(back!.step, "summary");
  assert.deepEqual(back!.rows, sample.rows);
  assert.deepEqual(back!.photos, sample.photos);
  assert.equal(back!.savedAt, NOW.toISOString());
});

// ── every failure means "start fresh", and none of them may throw ───────────

test("junk, empty and missing all come back null rather than throwing", () => {
  for (const bad of [null, undefined, "", "  ", "{{{", "[]", '"a string"', "42"]) {
    assert.doesNotThrow(() => parseStoredReview(bad as string));
    assert.equal(parseStoredReview(bad as string), null, JSON.stringify(bad));
  }
});

test("a draft written by an older version is ignored, not half-read", () => {
  const old = JSON.stringify({ version: 0, rows: [{ employeeId: "e1" }], summary: "x" });
  assert.equal(parseStoredReview(old), null);
});

test("a draft with no rows is not worth restoring", () => {
  assert.equal(parseStoredReview(serializeReview({ ...sample, rows: [] }, NOW)), null);
});

test("fields of the wrong type are replaced, not trusted", () => {
  const wonky = JSON.stringify({
    version: 1,
    savedAt: NOW.toISOString(),
    rows: [{ employeeId: "e1" }],
    summary: 42,
    unmatched: ["real", 7, null],
    photos: ["nope", { documentId: "doc-2", page: 2 }],
    step: 99,
  });
  const back = parseStoredReview(wonky);

  assert.ok(back);
  assert.equal(back!.summary, "", "a number is not a summary");
  assert.deepEqual(back!.unmatched, ["real"], "only the strings survive");
  assert.deepEqual(back!.photos, [{ documentId: "doc-2", page: 2 }]);
  assert.equal(back!.step, "hours", "an unusable step falls back to the first");
});

// ── freshness ───────────────────────────────────────────────────────────────

test("a draft from an hour ago is offered back", () => {
  assert.equal(isFresh(new Date(NOW.getTime() - 3_600_000).toISOString(), NOW), true);
});

test("YESTERDAY'S half-finished draft is NOT offered back", () => {
  // Restoring it over today would put yesterday's hours in front of him looking
  // exactly like today's.
  assert.equal(isFresh(new Date(NOW.getTime() - 30 * 3_600_000).toISOString(), NOW), false);
});

test("a draft from the future is not fresh, it is a broken clock", () => {
  assert.equal(isFresh(new Date(NOW.getTime() + 3_600_000).toISOString(), NOW), false);
});

test("an unparseable timestamp is not fresh", () => {
  assert.equal(isFresh("not a date", NOW), false);
  assert.equal(isFresh("", NOW), false);
});
