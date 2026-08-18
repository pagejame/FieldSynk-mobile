import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  matchRosterName,
  applyVoiceDraft,
  draftHoursTotal,
  type ApplicableRow,
  type VoiceDraft,
} from './voice-apply.ts'

// This is the step where a sentence becomes somebody's pay. The rules that matter
// most are the refusals: never guess which man was meant, never invent a short
// day, never flatten a split the office made on the desktop.

const row = (employeeId: string, name: string, o: Partial<ApplicableRow> = {}): ApplicableRow => ({
  employeeId,
  name,
  st: 0,
  ot: 0,
  dt: 0,
  out: false,
  reason: '',
  hoursMissed: '',
  locked: false,
  ...o,
})

const draft = (o: Partial<VoiceDraft> = {}): VoiceDraft => ({
  workPerformed: '',
  absences: [],
  materials: [],
  holdups: '',
  safety: '',
  crewNote: '',
  crewDefault: null,
  crew: [],
  ...o,
})

const CREW: ApplicableRow[] = [
  row('e1', 'Tony Ruiz'),
  row('e2', 'Dave Kolar'),
  row('e3', 'Mike Sanders'),
]

const SCHEDULED = 8

// ── matching a spoken name to a man ──────────────────────────────────────────

test('a full name matches', () => {
  assert.equal(matchRosterName('Tony Ruiz', CREW)?.employeeId, 'e1')
})

test('matching ignores case and extra spaces from the transcript', () => {
  assert.equal(matchRosterName('  tony   ruiz ', CREW)?.employeeId, 'e1')
})

test('a first name matches when only one man has it', () => {
  assert.equal(matchRosterName('Tony', CREW)?.employeeId, 'e1')
})

test('a last name matches when only one man has it', () => {
  assert.equal(matchRosterName('Kolar', CREW)?.employeeId, 'e2')
})

test('an ambiguous first name matches NOBODY rather than the first one', () => {
  const two = [...CREW, row('e4', 'Dave Prentiss')]
  assert.equal(matchRosterName('Dave', two), null)
})

test('two men with the same full name match nobody', () => {
  const twins = [row('e1', 'John Smith'), row('e2', 'John Smith')]
  assert.equal(matchRosterName('John Smith', twins), null)
})

test('a name nobody on the roster has matches nothing', () => {
  assert.equal(matchRosterName('Bartholomew', CREW), null)
  assert.equal(matchRosterName('', CREW), null)
  assert.equal(matchRosterName('   ', CREW), null)
})

// ── laying the wrap-up over the sheet ────────────────────────────────────────
// Every man gets his scheduled day unless the supervisor named him. This is the
// rule that makes the wrap-up short, and the one that has to be exactly right.

test('everyone the supervisor never mentioned gets their scheduled day', () => {
  const r = applyVoiceDraft(CREW, draft(), SCHEDULED)
  assert.deepEqual(r.rows.map((x) => x.st), [8, 8, 8])
  assert.equal(r.filledFromDefault, 3)
  assert.equal(draftHoursTotal(r.rows), 24)
})

test('a man reported out gets no hours, and his reason', () => {
  const r = applyVoiceDraft(
    CREW,
    draft({ crew: [{ name: 'Dave', status: 'out', hoursMissed: 8, reason: 'sick' }] }),
    SCHEDULED,
  )
  const dave = r.rows.find((x) => x.employeeId === 'e2')!
  assert.equal(dave.out, true)
  assert.equal(dave.st, 0)
  assert.equal(dave.reason, 'sick')
  assert.equal(dave.hoursMissed, '8')
  assert.equal(draftHoursTotal(r.rows), 16, 'the other two still worked')
})

test('a short day is the schedule less the hours missed', () => {
  // "Tony left at noon" — four hours missed off an eight-hour day.
  const r = applyVoiceDraft(
    CREW,
    draft({ crew: [{ name: 'Tony', status: 'short', hoursMissed: 4, reason: 'left at noon' }] }),
    SCHEDULED,
  )
  const tony = r.rows.find((x) => x.employeeId === 'e1')!
  assert.equal(tony.st, 4)
  assert.equal(tony.out, false)
  assert.equal(tony.reason, 'left at noon')
  assert.equal(draftHoursTotal(r.rows), 20)
})

test('a short day with no hours said is left for a human, not guessed', () => {
  // "Tony was short today" and nothing else. Inventing a number here would be
  // inventing a paycheck.
  const started = [row('e1', 'Tony Ruiz', { st: 8 })]
  const r = applyVoiceDraft(
    started,
    draft({ crew: [{ name: 'Tony', status: 'short', hoursMissed: null, reason: 'appointment' }] }),
    SCHEDULED,
  )
  assert.equal(r.rows[0].st, 8, 'left exactly as it was, for him to correct')
  assert.equal(r.rows[0].reason, 'appointment')
})

test('missing more than the day never produces negative hours', () => {
  const r = applyVoiceDraft(
    [row('e1', 'Tony Ruiz')],
    draft({ crew: [{ name: 'Tony', status: 'short', hoursMissed: 12, reason: '' }] }),
    SCHEDULED,
  )
  assert.equal(r.rows[0].st, 0)
})

test('a 10-hour job schedule fills 10, not 8', () => {
  // The default comes from the JOB, not from a constant baked in here.
  const r = applyVoiceDraft(CREW, draft(), 10)
  assert.deepEqual(r.rows.map((x) => x.st), [10, 10, 10])
})

test('a job with no schedule fills nothing rather than inventing a day', () => {
  const r = applyVoiceDraft(CREW, draft(), 0)
  assert.deepEqual(r.rows.map((x) => x.st), [0, 0, 0])
})

test('"everybody stayed till six" is applied over the schedule', () => {
  const r = applyVoiceDraft(CREW, draft({ crewDefault: { st: null, ot: 2, dt: null } }), SCHEDULED)
  assert.deepEqual(r.rows.map((x) => [x.st, x.ot]), [[8, 2], [8, 2], [8, 2]])
  assert.equal(draftHoursTotal(r.rows), 30)
})

test('someone already marked absent is not refilled to a full day', () => {
  const withAbsent = [CREW[0], { ...CREW[1], out: true, reason: 'sick' }, CREW[2]]
  const r = applyVoiceDraft(withAbsent, draft(), SCHEDULED)
  assert.equal(r.rows[1].st, 0)
  assert.equal(r.rows[1].out, true)
  assert.equal(r.filledFromDefault, 2)
})

test('a locked row is never touched, and is reported', () => {
  // The office split his day across two cost codes on the desktop. The phone has
  // one set of boxes and would collapse that split into a single line.
  const locked = [row('e1', 'Tony Ruiz', { locked: true, st: 4 }), CREW[2]]
  const r = applyVoiceDraft(locked, draft(), SCHEDULED)
  assert.equal(r.rows[0].st, 4, 'left exactly as it was')
  assert.deepEqual(r.skippedLocked, ['Tony Ruiz'])
  assert.equal(r.rows[1].st, 8, 'everyone else still filled')
})

test('a name that matches nobody is reported and nobody is docked', () => {
  const r = applyVoiceDraft(
    CREW,
    draft({ crew: [{ name: 'Bartholomew', status: 'out', hoursMissed: 8, reason: 'sick' }] }),
    SCHEDULED,
  )
  assert.deepEqual(r.unmatched, ['Bartholomew'])
  assert.deepEqual(r.rows.map((x) => x.st), [8, 8, 8], 'everyone still got their day')
})

test('an ambiguous name docks nobody', () => {
  // Two Daves. Marking the wrong one absent takes a day off the wrong man.
  const two = [...CREW, row('e4', 'Dave Prentiss')]
  const r = applyVoiceDraft(
    two,
    draft({ crew: [{ name: 'Dave', status: 'out', hoursMissed: 8, reason: 'sick' }] }),
    SCHEDULED,
  )
  assert.deepEqual(r.unmatched, ['Dave'])
  assert.ok(r.rows.every((x) => x.st === 8 && !x.out))
})

test('matched names come back for the read-back', () => {
  const r = applyVoiceDraft(
    CREW,
    draft({ crew: [{ name: 'Tony', status: 'out', hoursMissed: 8, reason: 'sick' }] }),
    SCHEDULED,
  )
  assert.deepEqual(r.matched, [{ spoken: 'Tony', name: 'Tony Ruiz' }])
})

test('half-hour schedules survive without float drift', () => {
  const r = applyVoiceDraft(
    [row('e1', 'A'), row('e2', 'B')],
    draft({ crew: [{ name: 'A', status: 'short', hoursMissed: 0.75, reason: '' }] }),
    7.5,
  )
  assert.equal(r.rows[0].st, 6.75)
  assert.equal(draftHoursTotal(r.rows), 14.25)
})
