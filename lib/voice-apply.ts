// Turning a spoken report into filled-in timesheet rows.
//
// The foreman says "everybody was on eight, Tony had ten, Dave was out sick".
// This decides which roster row each spoken name belongs to and what goes in the
// hours boxes. Nothing here saves anything — it prefills the grid the foreman is
// already looking at, and he presses save. That is where human-in-the-loop lives:
// he sees every number before it becomes payroll.
//
// The rule underneath all of it: NEVER guess a person. Two men called Dave and a
// transcript that says "Dave" is not enough to decide whose day it is, so it
// matches nobody and says so. A wrong match pays the wrong man.

// ============================================================================
// THIS IS THE WIRE FORMAT. It must match `VoiceCrewLine` in the web repo
// (`src/lib/field-agents/voice/extract.ts`) exactly — the server builds this and
// the phone consumes it, and nothing type-checks across the two repos.
//
// It did NOT match, from the day the server's extractor changed shape until
// 2026-08-19. The phone still expected `{st, ot, dt, out}` while the server had
// moved to `{status, hoursMissed}`. Both repos type-checked cleanly, because
// each was internally consistent — with different things. On the phone every
// field came back `undefined`, so `line.out` was falsy and `line.st ?? row.st`
// always took the row: a man reported OUT was not marked out, and a man reported
// SHORT was paid a full day. The per-man exceptions — the whole reason this
// section exists — vanished with no error anywhere.
//
// If you change either side, change both. There is no compiler that will catch
// you; `voice-wire.test.ts` is the only thing standing there.
// ============================================================================
export interface VoiceCrewLine {
  name: string
  /** "out" = not there at all. "short" = there, but not for the full day. */
  status: 'out' | 'short'
  /** How many hours they missed, when he said. null = he did not say. */
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
  /** ONLY the men who were out or short. Everyone else worked their schedule. */
  crew: VoiceCrewLine[]
  /**
   * The code the extractor thinks the day belongs to, with how sure it was.
   * The server sends it; the phone does not use it yet. Declared so the shape
   * stays honest about what actually arrives on the wire.
   */
  costCode?: { code: string; confidence: number } | null
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
  /**
   * Men he said were SHORT without saying how short.
   * Their hours are left at the full day, which is almost certainly wrong — the
   * screen must put this in front of him rather than let a full day be saved for
   * a man he just said left early.
   */
  missingHours: string[]
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Hours to the cent-equivalent. Subtracting 1.1 from 8 in floating point gives
 *  6.8999999999999995, which is not a figure to put on a timesheet. */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

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
): ApplyResult<T> {
  const matched: { spoken: string; name: string }[] = []
  const unmatched: string[] = []
  const skippedLocked: string[] = []
  const missingHours: string[] = []
  let filledFromDefault = 0

  // Resolve every spoken name first, so a name that matches nobody is reported
  // even if the blanket figure would otherwise make the day look complete.
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
  const hasDefault = !!d && (d.st !== null || d.ot !== null || d.dt !== null)

  const out = rows.map((row) => {
    // A row split across cost codes on the desktop is left exactly as it is —
    // the phone has one set of boxes and would silently collapse the split.
    if (row.locked) {
      if (byEmployee.has(row.employeeId) || hasDefault) skippedLocked.push(row.name)
      return row
    }

    const line = byEmployee.get(row.employeeId)

    if (line?.status === 'out') {
      // Reported off: no hours, and the reason he gave carries over.
      return { ...row, st: 0, ot: 0, dt: 0, out: true, reason: line.reason || row.reason }
    }

    if (line) {
      // SHORT: he was here, but not for the whole day. His day starts at the
      // blanket figure if the foreman gave one, otherwise whatever is already in
      // the boxes, and the missed hours come off it.
      const base = {
        st: d?.st ?? row.st,
        ot: d?.ot ?? row.ot,
        dt: d?.dt ?? row.dt,
      }
      const reason = line.reason || row.reason

      if (line.hoursMissed == null) {
        // He said this man missed time but not how much. Guessing a figure here
        // would put an invented number into somebody's pay, so the full day
        // stands and the name is reported for him to correct. The web asks him
        // on the spot; the phone can at least refuse to hide it.
        missingHours.push(row.name)
        return { ...row, ...base, out: false, reason }
      }

      // Hours come off the END of the day — double time first, then overtime,
      // then straight. A man who leaves early loses the last hours he would have
      // worked, not the first. The TOTAL matches what the web computes for the
      // same report (base total minus missed), which is the number that has to
      // agree between the two.
      let left = Math.max(0, line.hoursMissed)
      const take = (v: number) => {
        const t = Math.min(v, left)
        left = round2(left - t)
        return round2(v - t)
      }
      const dt = take(base.dt)
      const ot = take(base.ot)
      const st = take(base.st)
      return { ...row, st, ot, dt, out: false, reason }
    }

    // Not named. The blanket figure applies — but never to somebody already
    // marked off, because "everybody was on eight" plainly does not include the
    // man he just said was home sick.
    if (hasDefault && !row.out) {
      filledFromDefault++
      return {
        ...row,
        st: d!.st ?? row.st,
        ot: d!.ot ?? row.ot,
        dt: d!.dt ?? row.dt,
      }
    }

    return row
  })

  return { rows: out, matched, unmatched, skippedLocked, filledFromDefault, missingHours }
}

/** Total hours a draft would put on the sheet — shown before he saves. */
export function draftHoursTotal<T extends ApplicableRow>(rows: T[]): number {
  const sum = rows.reduce((t, r) => t + (r.out ? 0 : r.st + r.ot + r.dt), 0)
  return Math.round((sum + Number.EPSILON) * 100) / 100
}
