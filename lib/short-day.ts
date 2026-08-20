// DELIBERATE DUPLICATE of the web repo's copy — separate repos, separate
// release cycles, and a shared package would stop the phone shipping without
// the web. The TESTS are duplicated too, so a drift between them fails a test
// rather than making the phone pay a man differently from the browser.
// A man who did not work his whole scheduled day, and what he is paid for it.
//
// James's rule, stated with his own worked example:
//
//   "in the union if they are late, they still get the overtime hours. so if
//    someone was late three hours on a 10 hour shift for a union shop they would
//    be paid 5 hours straight time and 2 hours OT"
//
// A 10-hour union day is 8 straight and 2 overtime. A man three hours late works
// the LAST seven — which still includes the overtime at the end of the day. He
// has lost three hours of straight time, not two hours of premium.
//
// This is why hours-worked arithmetic gets it wrong. Feed 7 hours into a normal
// daily-threshold split and it returns 7 straight and no overtime, because it
// has no idea WHICH seven hours he worked. That is two hours of premium taken
// off a man for arriving late, which is not what the agreement says and is
// exactly the kind of quiet shortfall that ends up in a grievance.
//
// So the split is driven by the SCHEDULE, and the missed time comes off the
// straight-time end first.
//
// LATE AND LEAVING EARLY ARE NOT THE SAME THING and this file does not pretend
// otherwise — see `missedFrom`. A man who leaves early has worked the FIRST part
// of the day, so the hours he lost are the ones at the end, which are the
// premium ones. Same number of hours missed, different money. Nothing guesses
// which it was: the caller says, and if it does not know, it says so.

export type MissedFrom =
  /** Arrived late — he worked the END of the day, so the premium survives. */
  | "start"
  /** Left early — he worked the START of the day, so the premium goes first. */
  | "end"
  /** Not known which. Treated as "start" (his rule) and flagged for a human. */
  | "unknown";

export interface ShortDaySplit {
  st: number;
  ot: number;
  /** Hours actually paid. Never more than he was there for. */
  total: number;
  /** True when we had to assume which end of the day he missed. */
  assumed: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Split a scheduled day when the man missed part of it.
 *
 * `otDailyThreshold` is where the schedule turns straight time into overtime —
 * 8 on a 10-hour union day. A threshold at or above the scheduled day means
 * there is no daily premium to protect and this behaves like ordinary arithmetic.
 *
 * Double time is not produced here. Weekend and holiday premiums replace the
 * whole day's split rather than sitting inside it, and live in schedule.ts.
 */
export function splitShortDay(args: {
  /** What he was scheduled to work. */
  scheduledHours: number;
  /** How much of it he missed. */
  hoursMissed: number;
  /** Hours before the day goes to overtime. */
  otDailyThreshold: number;
  missedFrom?: MissedFrom;
}): ShortDaySplit {
  const scheduled = Math.max(0, Number(args.scheduledHours) || 0);
  const missedRaw = Math.max(0, Number(args.hoursMissed) || 0);
  // He cannot miss more of the day than there was. A figure larger than the
  // shift is a mis-heard number, and paying negative hours is not a thing.
  const missed = Math.min(missedRaw, scheduled);
  const threshold = Math.max(0, Number(args.otDailyThreshold) || 0);
  const from = args.missedFrom ?? "unknown";

  const fullSt = Math.min(scheduled, threshold);
  const fullOt = Math.max(0, scheduled - threshold);

  if (missed === 0) {
    return { st: round2(fullSt), ot: round2(fullOt), total: round2(scheduled), assumed: false };
  }

  let st: number;
  let ot: number;

  if (from === "end") {
    // Left early: the hours he lost are the last ones, which are the premium.
    const offOt = Math.min(fullOt, missed);
    ot = fullOt - offOt;
    st = fullSt - Math.max(0, missed - offOt);
  } else {
    // Late (or unknown, which follows the same rule): the hours he lost are the
    // first ones, so straight time absorbs it and the premium survives.
    const offSt = Math.min(fullSt, missed);
    st = fullSt - offSt;
    ot = fullOt - Math.max(0, missed - offSt);
  }

  st = Math.max(0, round2(st));
  ot = Math.max(0, round2(ot));

  return { st, ot, total: round2(st + ot), assumed: from === "unknown" && missed > 0 };
}
