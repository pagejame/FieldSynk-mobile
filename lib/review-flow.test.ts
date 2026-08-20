import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REVIEW_STEPS,
  checkStep,
  canAdvance,
  nextStep,
  prevStep,
  stepNumber,
  outstanding,
  type ReviewState,
} from './review-flow.ts';

const clean: ReviewState = {
  step: "hours",
  hoursConfirmed: true,
  missingCostCodes: 0,
  unmatchedNames: [],
  hasWorkSummary: true,
  safetyPhotos: 2,
};

test("the four screens are in James's order", () => {
  assert.deepEqual(REVIEW_STEPS, ["hours", "summary", "safety", "review"]);
  assert.equal(nextStep("hours"), "summary");
  assert.equal(nextStep("summary"), "safety");
  assert.equal(nextStep("safety"), "review");
  assert.equal(nextStep("review"), "review", "the last step does not run off the end");
  assert.equal(prevStep("hours"), "hours", "nor does the first go backwards");
  assert.equal(stepNumber("safety"), 3);
});

test("a clean day walks straight through with nothing to say", () => {
  for (const step of REVIEW_STEPS) {
    const c = checkStep(step, clean);
    assert.deepEqual(c.blockers, [], step);
    assert.deepEqual(c.warnings, [], step);
    assert.ok(canAdvance(step, clean));
  }
  assert.deepEqual(outstanding(clean), []);
});

// ── the one thing that blocks ───────────────────────────────────────────────

test("hours against a name nobody matches BLOCK — they cannot be paid to anyone", () => {
  const s = { ...clean, unmatchedNames: ["Szymanski"] };
  const c = checkStep("hours", s);

  assert.equal(c.blockers.length, 1);
  assert.match(c.blockers[0], /Szymanski/);
  assert.equal(canAdvance("hours", s), false);
});

test("several unmatched names are all named, not counted", () => {
  const s = { ...clean, unmatchedNames: ["Szymanski", "Delgado"] };
  const c = checkStep("hours", s);
  assert.match(c.blockers[0], /Szymanski/);
  assert.match(c.blockers[0], /Delgado/);
});

// ── everything else warns and lets him through ──────────────────────────────

test("a missing cost code WARNS but does not stop the day being filed", () => {
  // A wrap-up that refuses to save at half six because of a field the office
  // could fill in tomorrow is a wrap-up that gets abandoned — and then there is
  // no record at all, which is worse.
  const s = { ...clean, missingCostCodes: 1 };
  const c = checkStep("hours", s);

  assert.deepEqual(c.blockers, []);
  assert.equal(c.warnings.length, 1);
  assert.match(c.warnings[0], /still be filed/i);
  assert.ok(canAdvance("hours", s));
});

test("the cost-code warning counts correctly and reads naturally either way", () => {
  assert.match(checkStep("hours", { ...clean, missingCostCodes: 1 }).warnings[0], /^One worker/);
  assert.match(checkStep("hours", { ...clean, missingCostCodes: 4 }).warnings[0], /^4 workers/);
});

test("no work summary warns that this is the part the customer reads", () => {
  const s = { ...clean, hasWorkSummary: false };
  const c = checkStep("summary", s);
  assert.deepEqual(c.blockers, []);
  assert.match(c.warnings[0], /customer reads/i);
  assert.ok(canAdvance("summary", s));
});

test("no safety photos warns, and says plainly what will happen", () => {
  const s = { ...clean, safetyPhotos: 0 };
  const c = checkStep("safety", s);
  assert.deepEqual(c.blockers, []);
  assert.match(c.warnings[0], /filed with none attached/i);
  assert.ok(canAdvance("safety", s));
});

// ── the last screen ─────────────────────────────────────────────────────────

test("the final screen gathers everything unfinished, from every step", () => {
  const s: ReviewState = {
    ...clean,
    missingCostCodes: 2,
    hasWorkSummary: false,
    safetyPhotos: 0,
  };
  const all = outstanding(s);

  assert.equal(all.length, 3);
  assert.ok(all.some((x) => /cost code/i.test(x)));
  assert.ok(all.some((x) => /customer reads/i.test(x)));
  assert.ok(all.some((x) => /none attached/i.test(x)));
});

test("a blocker still appears on the final screen, not just on its own step", () => {
  const all = outstanding({ ...clean, unmatchedNames: ["Szymanski"] });
  assert.ok(all.some((x) => /Szymanski/.test(x)));
});
