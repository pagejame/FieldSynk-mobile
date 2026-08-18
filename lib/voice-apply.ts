// Turning the spoken wrap-up into filled-in timesheet rows.
//
// THE MODEL: every man is assumed to have worked his scheduled day. The
// supervisor names only the exceptions — "Dave was out sick, Tony left at noon" —
// and everyone he does not name is filled in at the job's normal hours. That is
// what makes the wrap-up short enough to actually do at the end of a shift: he
// says the two men who were off, not the eighteen who turned up.
//
// Nothing here saves anything. It prefills the grid he is already looking at and
// he presses save — that is where human-in-the-loop lives.
//
// The rule underneath all of it: NEVER guess a person. Two men called Dave and a
// transcript that says "Dave" is not enough to decide whose day it is, so it
// matches nobody and says so. A wrong match pays the wrong man.

export interface VoiceCrewLine {
  name: string
  /** "out" = not there at all. "short" = there, but not the full day. */
  status: 'out' | 'short'
  hoursMissed: number | null
  reason: string
}

export interface VoiceCrewDefault {
  st: number | null
  ot: number | null
  dt: number | null
}

export interface VoiceDraft {
  workPerformed: string
  absences: { name: string; reason: string }[]
  materials: { name: string; quantity: number | null; unit: string | null }[]
  holdups: string
  safety: string
  crewNote: string
  crewDefault: VoiceCrewDefault | null
  crew: VoiceCrewLine[]
}

/** The bits of a crew row this touches. Kept structural so the screen's own row
 *  type (which carries ids and locks) satisfies it without conversion. */
export interface ApplicableRow {
  employeeId: string
  name: string
  st: number
  ot: number
  dt: number
  out: boolean
  reason: string
  hoursMissed: string
  /** A desktop split across cost codes — the phone must not flatten it. */
  locked: boolean
}

export interface ApplyResult<T extends ApplicableRow> {
  rows: T[]
  /** Names the foreman said that were matched, for the read-back. */
  matched: { spoken: string; name: string }[]
  /** Names he said that matched nobody, or matched more than one person. */
  unmatched: string[]
  /** Rows left alone because they are locked. */
  skippedLocked: string[]
  /** How many rows the blanket figure filled. */
  filledFromDefault: number
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Which roster row a spoken name refers to, or null when it is not certain.
 *
 * Tries exact full name, then first name, then last name — and each of those only
 * when it lands on exactly ONE person. "Mike" with two Mikes on the roster is
 * ambiguous and returns null rather than picking the first.
 */
export function matchRosterName<T extends { employeeId: string; name: string }>(
  spoken: string,
  roster: T[],
): T | null {
  const q = norm(spoken)
  if (q === '') return null

  const exact = roster.filter((r) => norm(r.name) === q)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null // two people with the same full name — ask a human

  const parts = (r: T) => norm(r.name).split(' ').filter(Boolean)

  const byFirst = roster.filter((r) => parts(r)[0] === q)
  if (byFirst.length === 1) return byFirst[0]
  if (byFirst.length > 1) return null

  const byLast = roster.filter((r) => {
    const p = parts(r)
    return p.length > 1 && p[p.length - 1] === q
  })
  if (byLast.length === 1) return byLast[0]

  return null
}

/**
 * Lay a spoken draft over the crew rows.
 *
 * Order matters: the blanket figure fills everyone first, then the named people
 * overwrite it, because that is the order the foreman said it in ("everybody was
 * on eight, but Tony had ten").
 */
export function applyVoiceDraft<T extends ApplicableRow>(
  rows: T[],
  draft: VoiceDraft,
  /** A normal day on this job, from its schedule. Everyone not named gets this. */
  scheduledHours: number,
): ApplyResult<T> {
  const matched: { spoken: string; name: string }[] = []
  const unmatched: string[] = []
  const skippedLocked: string[] = []
  let filledFromDefault = 0

  const byEmployee = new Map<string, VoiceCrewLine>()
  for (const line of draft.crew) {
    const hit = matchRosterName(line.name, rows)
    if (!hit) {
      unmatched.push(line.name)
      continue
    }
    matched.push({ spoken: line.name, name: hit.name })
    byEmployee.set(hit.employeeId, line)
  }

  const d = draft.crewDefault
  const hasOverride = !!d && (d.st !== null || d.ot !== null || d.dt !== null)
  const normal = Number.isFinite(scheduledHours) && scheduledHours > 0 ? scheduledHours : 0

  const out = rows.map((row) => {
    // A row split across cost codes on the desktop is left exactly as it is —
    // the phone has one set of boxes and would silently collapse the split.
    if (row.locked) {
      skippedLocked.push(row.name)
      return row
    }

    const line = byEmployee.get(row.employeeId)

    if (line?.status === 'out') {
      // Out all day: no hours, and the reason he gave.
      return {
        ...row,
        st: 0,
        ot: 0,
        dt: 0,
        out: true,
        reason: line.reason || row.reason,
        hoursMissed: line.hoursMissed == null ? row.hoursMissed : String(line.hoursMissed),
      }
    }

    if (line?.status === 'short') {
      // There, but not all day. If he said how long they missed, the day is the
      // schedule less that. If he did not, the hours are left for him to enter —
      // a guessed short day is a guessed paycheck.
      const worked = line.hoursMissed == null ? row.st : Math.max(0, round2(normal - line.hoursMissed))
      return {
        ...row,
        st: worked,
        out: false,
        reason: line.reason || row.reason,
        hoursMissed: line.hoursMissed == null ? row.hoursMissed : String(line.hoursMissed),
      }
    }

    // Not named, so he had a normal day. THIS is the rule that makes the wrap-up
    // short: the supervisor names two men, not eighteen.
    if (!row.out) {
      filledFromDefault++
      return {
        ...row,
        st: hasOverride && d!.st !== null ? d!.st : normal,
        ot: hasOverride && d!.ot !== null ? d!.ot : row.ot,
        dt: hasOverride && d!.dt !== null ? d!.dt : row.dt,
      }
    }

    return row
  })

  return { rows: out, matched, unmatched, skippedLocked, filledFromDefault }
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Total hours a draft would put on the sheet — shown before he saves. */
export function draftHoursTotal<T extends ApplicableRow>(rows: T[]): number {
  const sum = rows.reduce((t, r) => t + (r.out ? 0 : r.st + r.ot + r.dt), 0)
  return Math.round((sum + Number.EPSILON) * 100) / 100
}
