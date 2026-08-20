import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyVoiceDraft, type ApplicableRow, type VoiceDraft } from './voice-apply.ts'
import { SERVER_PAYLOAD, CREW_LINE_KEYS } from './voice-wire.ts'

// Runtime half of the server contract. The COMPILE-time half lives in
// `voice-wire.ts`, because tsconfig excludes test files from tsc and
// `node --test` strips types without checking them — a type assertion written
// here would look like a guard and be nothing of the kind.

const row = (employeeId: string, name: string): ApplicableRow => ({
  employeeId,
  name,
  st: 0,
  ot: 0,
  dt: 0,
  out: false,
  reason: '',
  locked: false,
})

const CREW: ApplicableRow[] = [
  row('e1', 'Tony Ruiz'),
  row('e2', 'Dave Kolar'),
  row('e3', 'Mike Sanders'),
  row('e4', 'Luis Ortega'),
]

test('the sample the compiler checks is the sample these tests run', () => {
  // voice-wire.ts carries `SERVER_PAYLOAD: VoiceDraft`, so `tsc --noEmit` fails
  // if the shape parts company with the server. This asserts the two halves are
  // looking at the same object rather than drifting into separate fixtures.
  assert.equal(SERVER_PAYLOAD.crew.length, 3)
  assert.equal(SERVER_PAYLOAD.crewDefault?.st, 8)
})

test('every crew line carries status and hoursMissed, and nothing else for hours', () => {
  for (const line of SERVER_PAYLOAD.crew) {
    assert.deepEqual(
      Object.keys(line).sort(),
      [...CREW_LINE_KEYS],
      'the server changed the crew line shape — check src/lib/field-agents/voice/extract.ts',
    )
    assert.ok(line.status === 'out' || line.status === 'short')
  }
})

test('the real payload produces the right sheet — the end-to-end claim', () => {
  const r = applyVoiceDraft(CREW, SERVER_PAYLOAD as VoiceDraft)
  const by = (id: string) => r.rows.find((x) => x.employeeId === id)!

  // Dave was OUT. This is the exact assertion that was silently false before.
  assert.equal(by('e2').out, true, 'a man reported out must be marked out')
  assert.equal(by('e2').st, 0)
  assert.equal(by('e2').reason, 'sick')

  // Tony was SHORT by two, off a blanket 8 + 2. Missed hours come off the end.
  assert.equal(by('e1').out, false)
  assert.equal(by('e1').st + by('e1').ot + by('e1').dt, 8)

  // Mike was short but the foreman never said how much — full day stands, and
  // he is reported rather than quietly paid for it.
  assert.equal(by('e3').st + by('e3').ot + by('e3').dt, 10)
  assert.deepEqual(r.missingHours, ['Mike Sanders'])

  // Nobody was named for Luis, so the blanket figure applies.
  assert.equal(by('e4').st, 8)
  assert.equal(by('e4').ot, 2)

  assert.deepEqual(r.unmatched, [])
})

test('the cost code the server now sends does not break the phone', () => {
  // The phone ignores it today. It must not throw or be lost from the type.
  const draft: VoiceDraft = SERVER_PAYLOAD
  assert.equal(draft.costCode?.code, '02-100')
  assert.doesNotThrow(() => applyVoiceDraft(CREW, draft))
})
