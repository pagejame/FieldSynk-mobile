// DELIBERATE DUPLICATE of the web repo's copy, tests included — separate
// repos, separate release cycles. On a phone this matters MORE: the app is
// far likelier to be evicted mid-review than a browser tab is.
// Holding the foreman's review between screens, so a refresh does not cost him
// the day.
//
// He has just spent five minutes talking, then corrected the hours man by man.
// If the browser reloads, the phone dies, or he takes a call and the tab is
// evicted, all of that is gone and he has to do it again. Once. After that he
// stops using the wrap-up, which is the only failure mode that actually matters.
//
// KEPT ON THE DEVICE, not the server, and deliberately:
//   - none of it is agreed yet. A half-corrected sheet written to the database
//     is a day that exists without anybody having said it was right, and other
//     screens would start showing it.
//   - it survives the reload, which is the whole problem being solved.
//   - it needs no schema, no migration and no network — so it still works in the
//     dead spot where he is most likely to lose the page.
//
// It is thrown away the moment the day is filed. A stale draft reappearing over
// tomorrow's wrap-up would be worse than losing it.

const VERSION = 1;
const PREFIX = "fieldsynk.wrapup";

/** One key per job per day: two jobs in one afternoon must not overwrite each other. */
export function reviewDraftKey(jobId: string, date: string): string {
  return `${PREFIX}.v${VERSION}.${jobId}.${date}`;
}

export interface StoredReview<TRow = unknown, TDraft = unknown> {
  version: number;
  savedAt: string;
  rows: TRow[];
  summary: string;
  unmatched: string[];
  draft: TDraft;
  photos: { documentId: string; page: number }[];
  step: string;
}

/**
 * A saved review, or null.
 *
 * Null covers every way this can go wrong — no storage, wrong version, corrupt
 * JSON, a shape that is not what we wrote. All of them mean "start fresh", which
 * is exactly what happens today, so a bad draft can never be worse than no
 * draft. It must never throw: this runs on mount, and a crash here would take
 * the whole screen with it over a convenience feature.
 */
export function parseStoredReview<TRow = unknown, TDraft = unknown>(
  raw: string | null | undefined,
): StoredReview<TRow, TDraft> | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const o = parsed as Partial<StoredReview<TRow, TDraft>>;
  if (o.version !== VERSION) return null;
  if (!Array.isArray(o.rows) || o.rows.length === 0) return null;

  return {
    version: VERSION,
    savedAt: typeof o.savedAt === "string" ? o.savedAt : "",
    rows: o.rows as TRow[],
    summary: typeof o.summary === "string" ? o.summary : "",
    unmatched: Array.isArray(o.unmatched)
      ? o.unmatched.filter((x): x is string => typeof x === "string")
      : [],
    draft: (o.draft ?? {}) as TDraft,
    photos: Array.isArray(o.photos)
      ? o.photos.filter(
          (p): p is { documentId: string; page: number } =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as { documentId?: unknown }).documentId === "string",
        )
      : [],
    step: typeof o.step === "string" ? o.step : "hours",
  };
}

export function serializeReview<TRow, TDraft>(
  input: Omit<StoredReview<TRow, TDraft>, "version" | "savedAt">,
  now: Date,
): string {
  const payload: StoredReview<TRow, TDraft> = {
    version: VERSION,
    savedAt: now.toISOString(),
    ...input,
  };
  return JSON.stringify(payload);
}

/**
 * Is a saved review still worth offering back?
 *
 * A day old and it is almost certainly yesterday's, half-finished and forgotten;
 * restoring it over today would put yesterday's hours in front of him looking
 * like today's. The key is per-day so this is belt and braces, but the cost of
 * being wrong here is a wrong day filed.
 */
export function isFresh(savedAt: string, now: Date, maxHours = 18): boolean {
  const t = Date.parse(savedAt);
  if (Number.isNaN(t)) return false;
  const ageHours = (now.getTime() - t) / 3_600_000;
  return ageHours >= 0 && ageHours <= maxHours;
}
