import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recalcRow, dayOfWeek, isPremiumDay, type DayRules, type HoursRow } from './hours-row.ts'

// These must agree with the web repo's hours-sheet.test.ts. If one changes and
// the other does not, one of these fails — which is the point of duplicating it.

const UNION: DayRules = {
  otDailyThreshold: 8,
  saturdayRule: 'ot',
  sundayRule: 'dt',
  holidayRule: 'dt',
}

const WED = '2026-08-19'
const SAT = '2026-08-22'
const SUN = '2026-08-23'

const row = (over: Partial<HoursRow> = {}): HoursRow => ({
  employeeId: 'e1',
  name: 'Dave Lang',
  scheduledHours: 10,
  hoursMissed: 0,
  missedFrom: 'unknown',
  reason: '',
  st: 8,
  ot: 2,
  dt: 0,
  assumedEnd: false,
  costCodeId: 'cc-1',
  ...over,
})

test('the day of the week does not move with the phone timezone', () => {
  assert.equal(dayOfWeek('2026-08-23'), 0, 'Sunday')
  assert.equal(dayOfWeek('2026-08-22'), 6, 'Saturday')
  assert.equal(dayOfWeek('2026-08-19'), 3, 'Wednesday')
})

test('a full day is straight to the threshold, overtime after', () => {
  const r = recalcRow(row(), UNION, WED)
  assert.equal(r.st, 8)
  assert.equal(r.ot, 2)
})

test('LATE keeps the overtime — the same answer as the web', () => {
  const r = recalcRow(row({ hoursMissed: 3, missedFrom: 'start' }), UNION, WED)
  assert.equal(r.st, 5)
  assert.equal(r.ot, 2)
})

test('LEFT EARLY loses it — the same answer as the web', () => {
  const r = recalcRow(row({ hoursMissed: 5, missedFrom: 'end' }), UNION, WED)
  assert.equal(r.st, 5)
  assert.equal(r.ot, 0)
})

test('not knowing which end is flagged rather than silently split', () => {
  const r = recalcRow(row({ hoursMissed: 3, missedFrom: 'unknown' }), UNION, WED)
  assert.equal(r.assumedEnd, true)
})

test('a union Saturday is overtime from the first hour', () => {
  assert.ok(isPremiumDay(SAT))
  const r = recalcRow(row(), UNION, SAT)
  assert.equal(r.st, 0)
  assert.equal(r.ot, 10)
})

test('a union Sunday is double time', () => {
  const r = recalcRow(row(), UNION, SUN)
  assert.equal(r.dt, 10)
  assert.equal(r.st, 0)
})

test('late on a Saturday has no straight time to lose, and assumes nothing', () => {
  const r = recalcRow(row({ hoursMissed: 3, missedFrom: 'start' }), UNION, SAT)
  assert.equal(r.ot, 7)
  assert.equal(r.st, 0)
  assert.equal(r.assumedEnd, false)
})

test('a holiday paid at double time replaces the whole split', () => {
  const r = recalcRow(row(), UNION, WED, true)
  assert.equal(r.dt, 10)
})

test('a man out all day is paid nothing', () => {
  const r = recalcRow(row({ hoursMissed: 10, missedFrom: 'start' }), UNION, WED)
  assert.equal(r.st, 0)
  assert.equal(r.ot, 0)
  assert.equal(r.dt, 0)
})

test('editing never produces a negative', () => {
  const r = recalcRow(row({ hoursMissed: 99, missedFrom: 'end' }), UNION, WED)
  assert.ok(r.st >= 0 && r.ot >= 0 && r.dt >= 0)
})
