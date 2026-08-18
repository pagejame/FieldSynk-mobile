import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDayHistory,
  lastNDays,
  weekdayOf,
  missingDays,
  type HistoryLaborRow,
} from './day-history.ts'

// The history screen is how a foreman answers "did Tuesday go in?". If it says
// sent when the report is still on the phone, he stops chasing it and a man goes
// unpaid. These pin the rules that decide what each day says.

const lab = (date: string, employeeId: string | null, st: number, ot = 0, dt = 0): HistoryLaborRow => ({
  date,
  employeeId,
  st,
  ot,
  dt,
})

const build = (o: Partial<Parameters<typeof buildDayHistory>[0]> = {}) =>
  buildDayHistory({ days: ['2026-08-18'], labor: [], absences: [], reportDates: [], queuedDates: [], ...o })

// ── dates ────────────────────────────────────────────────────────────────────

test('weekday labels are read in UTC so they cannot slide a day', () => {
  assert.equal(weekdayOf('2026-08-18'), 'Tue')
  assert.equal(weekdayOf('2026-08-16'), 'Sun')
  assert.equal(weekdayOf('2026-08-22'), 'Sat')
})

test('a malformed date yields no label rather than a crash', () => {
  assert.equal(weekdayOf(''), '')
  assert.equal(weekdayOf('not-a-date'), '')
})

test('the day list runs backwards from today and never into the future', () => {
  const days = lastNDays('2026-08-18', 5)
  assert.deepEqual(days, ['2026-08-18', '2026-08-17', '2026-08-16', '2026-08-15', '2026-08-14'])
  assert.ok(days.every((d) => d <= '2026-08-18'))
})

test('the day list crosses a month boundary correctly', () => {
  assert.deepEqual(lastNDays('2026-09-02', 4), ['2026-09-02', '2026-09-01', '2026-08-31', '2026-08-30'])
})

test('a nonsense range returns nothing instead of looping', () => {
  assert.deepEqual(lastNDays('2026-08-18', 0), [])
  assert.deepEqual(lastNDays('', 5), [])
})

// ── what a day says ──────────────────────────────────────────────────────────

test('a day with hours reads as sent, with the crew counted', () => {
  const [d] = build({
    labor: [lab('2026-08-18', 'e1', 8), lab('2026-08-18', 'e2', 8, 2)],
  })
  assert.equal(d.status, 'sent')
  assert.equal(d.hours, 18)
  assert.equal(d.crewCount, 2)
})

test('one worker split across two cost codes is still one man on site', () => {
  const [d] = build({
    labor: [lab('2026-08-18', 'e1', 4), lab('2026-08-18', 'e1', 4)],
  })
  assert.equal(d.crewCount, 1)
  assert.equal(d.hours, 8)
})

test('a day where the crew was rained off still counts as logged', () => {
  // He reported it. Showing that as "nothing logged" would send him back to
  // re-enter a day he already did.
  const [d] = build({ absences: [{ date: '2026-08-18', employeeId: 'e1' }] })
  assert.equal(d.status, 'sent')
  assert.equal(d.absentCount, 1)
  assert.equal(d.hours, 0)
})

test('work performed with no hours still counts as logged', () => {
  const [d] = build({ reportDates: ['2026-08-18'] })
  assert.equal(d.status, 'sent')
  assert.ok(d.hasReport)
})

test('a genuinely empty day says nothing was logged', () => {
  const [d] = build()
  assert.equal(d.status, 'none')
  assert.equal(d.hours, 0)
  assert.equal(d.crewCount, 0)
})

test('a queued day says WAITING even when the server already has rows', () => {
  // The phone holds a correction the server has not taken yet. Saying "sent"
  // here would stop him chasing an edit that never landed.
  const [d] = build({
    labor: [lab('2026-08-18', 'e1', 8)],
    queuedDates: ['2026-08-18'],
  })
  assert.equal(d.status, 'waiting')
})

test('a queued day with nothing on the server also says waiting, not empty', () => {
  const [d] = build({ queuedDates: ['2026-08-18'] })
  assert.equal(d.status, 'waiting')
})

test('hours from other days never bleed into this one', () => {
  const days = buildDayHistory({
    days: ['2026-08-18', '2026-08-17'],
    labor: [lab('2026-08-18', 'e1', 8), lab('2026-08-17', 'e1', 10)],
    absences: [],
    reportDates: [],
    queuedDates: [],
  })
  assert.equal(days[0].hours, 8)
  assert.equal(days[1].hours, 10)
})

test('fractional hours add up without float drift', () => {
  const [d] = build({
    labor: [lab('2026-08-18', 'e1', 7.5), lab('2026-08-18', 'e2', 0.25), lab('2026-08-18', 'e3', 0.35)],
  })
  assert.equal(d.hours, 8.1)
})

test('negative or broken hours are ignored, never subtracted', () => {
  const [d] = build({
    labor: [lab('2026-08-18', 'e1', 8), lab('2026-08-18', 'e2', -4)],
  })
  assert.equal(d.hours, 8)
  assert.equal(d.crewCount, 1, 'a row with no real hours is not a man on site')
})

test('labor with no worker attached still counts hours but not a head', () => {
  const [d] = build({ labor: [lab('2026-08-18', null, 8)] })
  assert.equal(d.hours, 8)
  assert.equal(d.crewCount, 0)
})

test('the rows come back in the order asked for', () => {
  const days = buildDayHistory({
    days: lastNDays('2026-08-18', 3),
    labor: [],
    absences: [],
    reportDates: [],
    queuedDates: [],
  })
  assert.deepEqual(days.map((d) => d.date), ['2026-08-18', '2026-08-17', '2026-08-16'])
})

// ── what he still owes ───────────────────────────────────────────────────────

test('missing days are listed oldest first — the oldest gap is the urgent one', () => {
  const days = buildDayHistory({
    days: ['2026-08-18', '2026-08-17', '2026-08-16'],
    labor: [lab('2026-08-17', 'e1', 8)],
    absences: [],
    reportDates: [],
    queuedDates: [],
  })
  assert.deepEqual(missingDays(days), ['2026-08-16', '2026-08-18'])
})

test('a day waiting to send is not counted as missing', () => {
  const days = buildDayHistory({
    days: ['2026-08-18'],
    labor: [],
    absences: [],
    reportDates: [],
    queuedDates: ['2026-08-18'],
  })
  assert.deepEqual(missingDays(days), [], 'he already did it; it just has not landed')
})
