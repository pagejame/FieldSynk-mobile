import type { VoiceDraft } from './voice-apply'

// The hand-off between the voice screen and the timesheet.
//
// A draft is a whole spoken report — crew hours, absences, materials, work
// performed. Passing that through a URL query string would be fragile and would
// put a man's hours in a navigation log, so it is held in memory for the seconds
// between "read it back" and the timesheet opening.
//
// Deliberately NOT persisted: a draft is unconfirmed speech. If the app is killed
// before the foreman reviews it, it should be gone rather than resurface days
// later and get saved without anyone reading it. Whatever he confirms goes
// through the normal save path, which is what the offline queue protects.

interface Held {
  jobId: string
  date: string
  draft: VoiceDraft
}

let held: Held | null = null

/** Hand a freshly spoken draft to the timesheet screen. */
export function putVoiceDraft(jobId: string, date: string, draft: VoiceDraft): void {
  held = { jobId, date, draft }
}

/**
 * Take the draft for this job+day, if one is waiting. Consuming it clears it, so
 * navigating back to the timesheet later does not re-apply a draft the foreman
 * has already dealt with.
 */
export function takeVoiceDraft(jobId: string, date: string): VoiceDraft | null {
  if (!held || held.jobId !== jobId || held.date !== date) return null
  const d = held.draft
  held = null
  return d
}

/** Drop anything waiting — used when a recording is redone. */
export function clearVoiceDraft(): void {
  held = null
}
