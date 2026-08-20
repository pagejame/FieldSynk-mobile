import { test } from "node:test";
import assert from "node:assert/strict";
import { splitShortDay } from './short-day.ts';

// A 10-hour union day: 8 straight, 2 overtime.
const UNION_10 = { scheduledHours: 10, otDailyThreshold: 8 };

test("JAMES'S CASE: three hours late on a 10-hour union day is 5 ST and 2 OT", () => {
  // His words: "if someone was late three hours on a 10 hour shift for a union
  // shop they would be paid 5 hours straight time and 2 hours OT".
  const r = splitShortDay({ ...UNION_10, hoursMissed: 3, missedFrom: "start" });
  assert.equal(r.st, 5);
  assert.equal(r.ot, 2);
  assert.equal(r.total, 7);
});

test("plain hours-worked arithmetic would get that wrong, which is the point", () => {
  // 7 hours through a daily-threshold split is 7 ST and 0 OT — two hours of
  // premium taken off a man for arriving late.
  const r = splitShortDay({ ...UNION_10, hoursMissed: 3, missedFrom: "start" });
  assert.notEqual(r.st, 7);
  assert.ok(r.ot > 0, "the premium must survive being late");
});

test("a full day is the ordinary split, and is not 'assumed'", () => {
  const r = splitShortDay({ ...UNION_10, hoursMissed: 0 });
  assert.deepEqual({ st: r.st, ot: r.ot, total: r.total }, { st: 8, ot: 2, total: 10 });
  assert.equal(r.assumed, false);
});

test("JAMES'S SECOND CASE: on time, leaves after 5 hours, is 5 ST and no OT", () => {
  // His words: "they show up on time leave after working 5 hours. They get 5
  // Hours ST with no OT that day." He worked the FIRST five of a 10-hour day, so
  // he never reached the premium at the end of it.
  const r = splitShortDay({ ...UNION_10, hoursMissed: 5, missedFrom: "end" });
  assert.equal(r.st, 5);
  assert.equal(r.ot, 0);
  assert.equal(r.total, 5);
});

test("leaving early loses the premium first — the opposite end of the day", () => {
  // He worked the FIRST seven hours, so the hours he lost are the overtime.
  const r = splitShortDay({ ...UNION_10, hoursMissed: 3, missedFrom: "end" });
  assert.equal(r.ot, 0);
  assert.equal(r.st, 7);
  assert.equal(r.total, 7);
});

test("late and leaving early pay differently for the same hours missed", () => {
  const late = splitShortDay({ ...UNION_10, hoursMissed: 3, missedFrom: "start" });
  const early = splitShortDay({ ...UNION_10, hoursMissed: 3, missedFrom: "end" });

  assert.equal(late.total, early.total, "same hours present");
  assert.notDeepEqual(
    { st: late.st, ot: late.ot },
    { st: early.st, ot: early.ot },
    "but not the same money",
  );
});

test("when nobody said which end, it follows the union rule and says it assumed", () => {
  const r = splitShortDay({ ...UNION_10, hoursMissed: 3 });
  assert.equal(r.st, 5);
  assert.equal(r.ot, 2);
  // Flagged, because it is a guess about money and somebody should see it.
  assert.equal(r.assumed, true);
});

test("missing more than the whole shift pays nothing, never a negative", () => {
  const r = splitShortDay({ ...UNION_10, hoursMissed: 99, missedFrom: "start" });
  assert.equal(r.st, 0);
  assert.equal(r.ot, 0);
  assert.equal(r.total, 0);
});

test("missing exactly the straight-time portion leaves only the premium", () => {
  const r = splitShortDay({ ...UNION_10, hoursMissed: 8, missedFrom: "start" });
  assert.equal(r.st, 0);
  assert.equal(r.ot, 2);
});

test("missing past the straight time starts eating the premium", () => {
  const r = splitShortDay({ ...UNION_10, hoursMissed: 9, missedFrom: "start" });
  assert.equal(r.st, 0);
  assert.equal(r.ot, 1);
});

test("an 8-hour day has no premium to protect, so late is just short", () => {
  const r = splitShortDay({ scheduledHours: 8, otDailyThreshold: 8, hoursMissed: 2 });
  assert.equal(r.st, 6);
  assert.equal(r.ot, 0);
});

test("a 12-hour day keeps all four premium hours when he is two hours late", () => {
  const r = splitShortDay({
    scheduledHours: 12,
    otDailyThreshold: 8,
    hoursMissed: 2,
    missedFrom: "start",
  });
  assert.equal(r.st, 6);
  assert.equal(r.ot, 4);
  assert.equal(r.total, 10);
});

test("half hours survive the arithmetic", () => {
  const r = splitShortDay({
    scheduledHours: 10,
    otDailyThreshold: 8,
    hoursMissed: 1.5,
    missedFrom: "start",
  });
  assert.equal(r.st, 6.5);
  assert.equal(r.ot, 2);
});

test("nonsense in does not produce nonsense out", () => {
  for (const bad of [NaN, -5, undefined]) {
    const r = splitShortDay({
      scheduledHours: 10,
      otDailyThreshold: 8,
      hoursMissed: bad as number,
    });
    assert.ok(r.st >= 0 && r.ot >= 0, `hoursMissed=${String(bad)}`);
    assert.equal(r.total, r.st + r.ot);
  }

  const noSchedule = splitShortDay({
    scheduledHours: 0,
    otDailyThreshold: 8,
    hoursMissed: 3,
  });
  assert.equal(noSchedule.total, 0);
});
