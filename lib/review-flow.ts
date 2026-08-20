// DELIBERATE DUPLICATE of the web repo's copy — separate repos, separate
// release cycles, and a shared package would stop the phone shipping without
// the web. The TESTS are duplicated too, so a drift between them fails a test
// rather than making the phone behave differently from the browser.
// What the foreman walks through after he has finished talking.
//
//   hours -> summary -> safety -> review -> saved
//
// James's flow, in his order. The agent gathers; these four screens are where a
// person takes responsibility for it before any of it becomes pay or a record.
//
// WHAT BLOCKS AND WHAT MERELY WARNS — the distinction is the whole file.
//
// Almost nothing blocks. A man with no cost code still gets his hours; the code
// is filled in by the office. A day with no safety photo still files. The reason
// is not laxity: a wrap-up that refuses to save at half past six, on a phone
// with one bar, because of a field the office could fill in tomorrow, is a
// wrap-up that gets abandoned — and then there is no record at all, which is
// strictly worse than an incomplete one.
//
// So the screens SHOW what is unfinished, by name, every time, and let him
// decide. The one thing that does block is hours nobody can attribute: a name
// the system could not match to a worker. Those hours would otherwise be paid
// to nobody or, worse, to the wrong man.

export type ReviewStep = "hours" | "summary" | "safety" | "review" | "saved";

export const REVIEW_STEPS: ReviewStep[] = ["hours", "summary", "safety", "review"];

export const STEP_TITLE: Record<ReviewStep, string> = {
  hours: "Hours and cost codes",
  summary: "Work performed",
  safety: "Safety documents",
  review: "Check the day",
  saved: "Filed",
};

export interface ReviewState {
  step: ReviewStep;
  /** Rows the foreman has confirmed on the hours screen. */
  hoursConfirmed: boolean;
  /** How many workers still have no cost code. */
  missingCostCodes: number;
  /**
   * How many cost codes this job has at all.
   *
   * Zero changes what the missing-code warning MEANS: it stops being something
   * he can fix and becomes a fact about the job's setup. Telling a man on a site
   * that four workers need a code, when the job has none to give them, is noise
   * he learns to scroll past — and then he scrolls past the real warnings too.
   */
  costCodesAvailable: number;
  /** Names the agent heard that matched no worker. These BLOCK. */
  unmatchedNames: string[];
  /** Whether the work summary has any text at all. */
  hasWorkSummary: boolean;
  /** Safety photos uploaded so far. */
  safetyPhotos: number;
}

export interface StepCheck {
  /** Hard stops. Empty means he may go on. */
  blockers: string[];
  /** Worth him seeing, but his call. */
  warnings: string[];
}

/**
 * What is wrong on the step he is looking at.
 *
 * Warnings are phrased as what will happen, not as a scolding — he is standing
 * in a car park and has read enough forms today.
 */
export function checkStep(step: ReviewStep, s: ReviewState): StepCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (step === "hours") {
    // The one real stop. Hours against a name nobody recognises cannot be paid
    // to anyone, and guessing which man was meant is how one man's day lands on
    // another man's cheque.
    if (s.unmatchedNames.length > 0) {
      blockers.push(
        s.unmatchedNames.length === 1
          ? `Nobody on this crew matches "${s.unmatchedNames[0]}". Pick the right worker or remove the line.`
          : `These names match nobody on the crew: ${s.unmatchedNames.join(", ")}. Sort them out before the hours can be filed.`,
      );
    }
    if (s.missingCostCodes > 0 && s.costCodesAvailable > 0) {
      warnings.push(
        s.missingCostCodes === 1
          ? "One worker has no cost code. His hours will still be filed and the office can add it."
          : `${s.missingCostCodes} workers have no cost code. Their hours will still be filed and the office can add them.`,
      );
    }
  }

  if (step === "summary" && !s.hasWorkSummary) {
    warnings.push(
      "There's nothing written for what the crew got done. This is the part the customer reads.",
    );
  }

  if (step === "safety" && s.safetyPhotos === 0) {
    warnings.push(
      "No safety documents added. The day will be filed with none attached.",
    );
  }

  return { blockers, warnings };
}

export const canAdvance = (step: ReviewStep, s: ReviewState): boolean =>
  checkStep(step, s).blockers.length === 0;

export function nextStep(step: ReviewStep): ReviewStep {
  const i = REVIEW_STEPS.indexOf(step);
  if (i === -1 || i === REVIEW_STEPS.length - 1) return "review";
  return REVIEW_STEPS[i + 1];
}

export function prevStep(step: ReviewStep): ReviewStep {
  const i = REVIEW_STEPS.indexOf(step);
  return i <= 0 ? "hours" : REVIEW_STEPS[i - 1];
}

/** 1-based, for "step 2 of 4". `saved` is past the end. */
export function stepNumber(step: ReviewStep): number {
  const i = REVIEW_STEPS.indexOf(step);
  return i === -1 ? REVIEW_STEPS.length : i + 1;
}

/**
 * Everything still unfinished, gathered for the final screen.
 *
 * He sees this ONCE more before it is filed, because the last screen is the last
 * chance anybody looks at it with the day still fresh. After this it is a record
 * that gets read by people who were not there.
 */
export function outstanding(s: ReviewState): string[] {
  const out: string[] = [];
  for (const step of REVIEW_STEPS) {
    const { blockers, warnings } = checkStep(step, s);
    out.push(...blockers, ...warnings);
  }
  return out;
}
