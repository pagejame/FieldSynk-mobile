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
// most are the refusals: never guess which man was meant, never turn silence into
// zero, never flatten a split the office made on the desktop.

const row = (employeeId: string, name: string, o: Partial<ApplicableRow> = {}): ApplicableRow => ({
  employeeId,
  name,
  st: 0,
  ot: 0,
  dt: 0,
  out: false,
  reason: '',
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
  // Two Daves and a transcript that says "Dave" is not enough to decide whose
  // day it is. Picking one pays the wrong man.
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

// ── laying the draft over the sheet ──────────────────────────────────────────

test('"everybody was on eight" fills the whole crew', () => {
  const r = applyVoiceDraft(CREW, draft({ crewDefault: { st: 8, ot: null, dt: null } }))
  assert.deepEqual(r.rows.map((x) => x.st), [8, 8, 8])
  assert.equal(r.filledFromDefault, 3)
  assert.equal(draftHoursTotal(r.rows), 24)
})

test('a man who left early is short by what he missed, off the blanket figure', () => {
  // "Everybody was on eight, Tony left two hours early."
  const r = applyVoiceDraft(
    CREW,
    draft({
      crewDefault: { st: 8, ot: null, dt: null },
      crew: [{ name: 'Tony', status: 'short', hoursMissed: 2, reason: 'dentist' }],
    }),
  )
  const tony = r.rows.find((x) => x.employeeId === 'e1')!
  assert.equal(tony.st, 6)
  assert.equal(tony.out, false)
  assert.equal(tony.reason, 'dentist')
  assert.equal(r.rows.find((x) => x.employeeId === 'e3')!.st, 8, 'the rest still get the blanket')
  assert.equal(draftHoursTotal(r.rows), 22)
})

test('missed hours come off the END of the day, not the start', () => {
  // "Everybody was on eight and two, Tony left three hours early." He loses the
  // last three hours he would have worked — the premium ones — not his first.
  const r = applyVoiceDraft(
    CREW,
    draft({
      crewDefault: { st: 8, ot: 2, dt: null },
      crew: [{ name: 'Tony', status: 'short', hoursMissed: 3, reason: '' }],
    }),
  )
  const tony = r.rows.find((x) => x.employeeId === 'e1')!
  assert.equal(tony.ot, 0)
  assert.equal(tony.st, 7)
  // The total is what has to agree with the web: base 10 minus 3 missed.
  assert.equal(tony.st + tony.ot + tony.dt, 7)
})

test('missing more than the whole day never goes negative', () => {
  const r = applyVoiceDraft(
    CREW,
    draft({
      crewDefault: { st: 8, ot: null, dt: null },
      crew: [{ name: 'Tony', status: 'short', hoursMissed: 99, reason: '' }],
    }),
  )
  const tony = r.rows.find((x) => x.employeeId === 'e1')!
  assert.deepEqual([tony.st, tony.ot, tony.dt], [0, 0, 0])
})

test('fractional missed hours do not drift', () => {
  const r = applyVoiceDraft(
    [row('e1', 'Tony Ruiz')],
    draft({
      crewDefault: { st: 8, ot: null, dt: null },
      crew: [{ name: 'Tony', status: 'short', hoursMissed: 1.1, reason: '' }],
    }),
  )
  assert.equal(r.rows[0].st, 6.9)
})

test('a man reported off gets no hours and keeps his reason', () => {
  const r = applyVoiceDraft(
    CREW,
    draft({
      crewDefault: { st: 8, ot: null, dt: null },
      crew: [{ name: 'Dave', status: 'out', hoursMissed: null, reason: 'sick' }],
    }),
  )
  const dave = r.rows.find((x) => x.employeeId === 'e2')!
  assert.equal(dave.out, true)
  assert.equal(dave.reason, 'sick')
  assert.equal(dave.st, 0)
  assert.equal(draftHoursTotal(r.rows), 16, 'only the two who worked')
})

test('the blanket figure never reaches a man already marked off', () => {
  // "Everybody was on eight" plainly does not include the man he just said was
  // home sick.
  const withAbsent = [CREW[0], { ...CREW[1], out: true, reason: 'sick' }, CREW[2]]
  const r = applyVoiceDraft(withAbsent, draft({ crewDefault: { st: 8, ot: null, dt: null } }))
  assert.equal(r.rows[1].st, 0)
  assert.equal(r.rows[1].out, true)
  assert.equal(r.filledFromDefault, 2)
})

test('"he was short" with no figure keeps the day AND is reported', () => {
  // Inventing a number here puts a made-up figure into somebody's pay. The full
  // day stands, and his name comes back so the screen can put it in front of the
  // foreman instead of quietly saving a full day for a man he said left early.
  const started = [row('e1', 'Tony Ruiz', { st: 8 })]
  const r = applyVoiceDraft(
    started,
    draft({ crew: [{ name: 'Tony', status: 'short', hoursMissed: null, reason: 'dentist' }] }),
  )
  assert.equal(r.rows[0].st, 8)
  assert.equal(r.rows[0].out, false)
  assert.equal(r.rows[0].reason, 'dentist')
  assert.deepEqual(r.missingHours, ['Tony Ruiz'])
})

test('a man who was OUT is not reported as missing a figure', () => {
  // Out is a whole day. There is no number to ask for.
  const r = applyVoiceDraft(
    CREW,
    draft({ crew: [{ name: 'Dave', status: 'out', hoursMissed: null, reason: 'sick' }] }),
  )
  assert.deepEqual(r.missingHours, [])
})

test('a locked row is never touched, and is reported', () => {
  // The office split his day across two cost codes on the desktop. The phone has
  // one set of boxes and would collapse that split into a single line.
  const locked = [row('e1', 'Tony Ruiz', { locked: true, st: 4 }), CREW[2]]
  const r = applyVoiceDraft(locked, draft({ crewDefault: { st: 8, ot: null, dt: null } }))
  assert.equal(r.rows[0].st, 4, 'left exactly as it was')
  assert.deepEqual(r.skippedLocked, ['Tony Ruiz'])
  assert.equal(r.rows[1].st, 8, 'everyone else still filled')
})

test('a spoken name that matches nobody is reported, not silently dropped', () => {
  const r = applyVoiceDraft(
    CREW,
    draft({ crew: [{ name: 'Bartholomew', status: 'short', hoursMissed: 2, reason: '' }] }),
  )
  assert.deepEqual(r.unmatched, ['Bartholomew'])
  assert.deepEqual(r.rows.map((x) => x.st), [0, 0, 0], 'nobody got his hours')
})

test('an ambiguous name is reported as unmatched rather than paid to a guess', () => {
  const two = [...CREW, row('e4', 'Dave Prentiss')]
  const r = applyVoiceDraft(
    two,
    draft({ crew: [{ name: 'Dave', status: 'out', hoursMissed: null, reason: '' }] }),
  )
  assert.deepEqual(r.unmatched, ['Dave'])
  assert.equal(r.rows.find((x) => x.employeeId === 'e2')!.st, 0)
  assert.equal(r.rows.find((x) => x.employeeId === 'e4')!.st, 0)
})

test('matched names come back for the read-back', () => {
  const r = applyVoiceDraft(
    CREW,
    draft({ crew: [{ name: 'Tony', status: 'out', hoursMissed: null, reason: '' }] }),
  )
  assert.deepEqual(r.matched, [{ spoken: 'Tony', name: 'Tony Ruiz' }])
})

test('an empty draft changes nothing', () => {
  const started = [row('e1', 'Tony Ruiz', { st: 8 })]
  const r = applyVoiceDraft(started, draft())
  assert.deepEqual(r.rows, started)
  assert.equal(r.filledFromDefault, 0)
  assert.deepEqual(r.unmatched, [])
})

test('fractional hours total without float drift', () => {
  const r = applyVoiceDraft(
    [row('e1', 'A'), row('e2', 'B'), row('e3', 'C')],
    draft({ crewDefault: { st: 7.5, ot: null, dt: null } }),
  )
  assert.equal(draftHoursTotal(r.rows), 22.5)
})

test('a blanket overtime figure fills only overtime', () => {
  const started = [row('e1', 'A', { st: 8 }), row('e2', 'B', { st: 8 })]
  const r = applyVoiceDraft(started, draft({ crewDefault: { st: null, ot: 2, dt: null } }))
  assert.deepEqual(r.rows.map((x) => [x.st, x.ot]), [[8, 2], [8, 2]])
  assert.equal(draftHoursTotal(r.rows), 20)
})
