// ============================================================================
// THE CONTRACT WITH THE SERVER — the one thing standing between two repos.
//
// The phone and the web are separate codebases. Nothing type-checks across
// them, so the wire format has exactly one guard: the typed constant below.
//
// It lives in a SOURCE file, not a test file, on purpose. `tsconfig.json`
// excludes `**/*.test.ts` from tsc, and `node --test` strips types without
// checking them — so a type assertion written in a test is decorative. Here,
// `tsc --noEmit` genuinely fails if the payload stops matching `VoiceDraft`.
//
// The payload is not hand-written. It is the verbatim output of the WEB repo's
// own `parseVoiceDraft` (src/lib/field-agents/voice/extract.ts) over a model
// response. To refresh it, run that parser and paste the result — do not edit
// it to make a build pass, because making it match by hand is precisely how the
// original bug survived.
//
// WHAT THIS CATCHES: anyone editing the phone's types without knowing what
// actually arrives.
// WHAT IT DOES NOT CATCH: the SERVER changing shape on its own. Nothing on this
// side can see the other repo. That hole is still open, and it is the hole the
// original bug came through — whoever edits the web extractor must update this
// file too.
//
// THE BUG THIS EXISTS TO PREVENT: the server moved crew lines from
// `{st, ot, dt, out}` to `{status, hoursMissed}`. The phone kept the old shape.
// Both repos type-checked, because each was internally consistent with a
// different thing. On the phone every field read `undefined`, so a man reported
// OUT was not marked out and a man reported SHORT was paid a full day. No error
// anywhere, and it reached payroll.
// ============================================================================

import type { VoiceDraft } from './voice-apply'

/**
 * Verbatim output of the web repo's `parseVoiceDraft`. Regenerate, don't edit.
 *
 * The `: VoiceDraft` annotation is the whole point of this file — it is what
 * makes a shape change a compile error rather than a silent wrong paycheque.
 */
export const SERVER_PAYLOAD: VoiceDraft = {
  workPerformed: 'Rough-in on level 2, pulled feeders to panel B.',
  absences: [{ name: 'Dave Kolar', reason: 'sick' }],
  materials: [{ name: '3/4 EMT', quantity: 200, unit: 'ft' }],
  holdups: 'Waited on the GC to open the riser.',
  safety: 'JHA done, no incidents.',
  crewNote: '',
  crewDefault: { st: 8, ot: 2, dt: null },
  crew: [
    { name: 'Dave Kolar', status: 'out', hoursMissed: null, reason: 'sick' },
    { name: 'Tony Ruiz', status: 'short', hoursMissed: 2, reason: 'dentist' },
    { name: 'Mike Sanders', status: 'short', hoursMissed: null, reason: 'left early' },
  ],
  costCode: { code: '02-100', confidence: 0.92 },
}

/** The keys a crew line must have. Asserted at runtime by voice-wire.test.ts. */
export const CREW_LINE_KEYS = ['hoursMissed', 'name', 'reason', 'status'] as const
