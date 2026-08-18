// What a foreman has actually sent in, day by day.
//
// He can already correct a past day — the log screen has date arrows and reloads
// that day's rows. What he could not do was SEE anything: which days went in,
// which are blank, and whether Tuesday's report is still sitting on the phone
// waiting for signal. On a job where a missed day means a man goes unpaid, that
// blind spot is the whole problem.
//
// Pure logic, no database and no React, so the rules below are pinned by tests.

export type DayStatus =
  /** On the server. */
  | 'sent'
  /** Saved on the phone, not yet accepted by the server. */
  | 'waiting'
  /** Nothing logged for this day. */
  | 'none'

export interface DaySummary {
  date: string
  /** 'Mon' — computed in UTC so the label can't slide a day near midnight. */
  weekday: string
  /** Total ST + OT + DT logged that day. */
  hours: number
  /** How many people have hours. */
  crewCount: number
  /** How many were marked out. */
  absentCount: number
  /** Work-performed was written for the day. */
  hasReport: boolean
  status: DayStatus
}

export interface HistoryLaborRow {
  date: string
  employeeId: string | null
  st: number
  ot: number
  dt: number
}

export interface HistoryAbsenceRow {
  date: string
  employeeId: string | null
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** 'Mon' for a YYYY-MM-DD, read as UTC so a timezone can't shift the label. */
export function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? ''
}

/**
 * The last `count` dates ending at `endIso`, most recent first.
 * Never returns a future date — you cannot log tomorrow's hours.
 */
export function lastNDays(endIso: string, count: number): string[] {
  const [y, m, d] = endIso.split('-').map(Number)
  if (!y || !m || !d || count <= 0) return []
  const end = Date.UTC(y, m - 1, d)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    out.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10))
  }
  return out
}

/**
 * Fold a job's rows into one line per day.
 *
 * `queuedDates` wins over whatever the server holds: if the phone is still
 * carrying an edit for that day, the newest truth is on the phone, and telling
 * the foreman "sent" while his correction sits unsent would be a lie he'd act on.
 */
export function buildDayHistory(args: {
  days: string[]
  labor: HistoryLaborRow[]
  absences: HistoryAbsenceRow[]
  /** Dates with a daily_reports row (work performed written). */
  reportDates: string[]
  /** Dates still sitting in the offline queue for this job. */
  queuedDates: string[]
}): DaySummary[] {
  const { days, labor, absences, reportDates, queuedDates } = args

  const hoursByDate = new Map<string, number>()
  const crewByDate = new Map<string, Set<string>>()
  for (const l of labor) {
    const total = num(l.st) + num(l.ot) + num(l.dt)
    if (total <= 0) continue
    hoursByDate.set(l.date, round2((hoursByDate.get(l.date) ?? 0) + total))
    // One worker split across two cost codes is still one man on site.
    if (l.employeeId) {
      const set = crewByDate.get(l.date) ?? new Set<string>()
      set.add(l.employeeId)
      crewByDate.set(l.date, set)
    }
  }

  const absentByDate = new Map<string, Set<string>>()
  for (const a of absences) {
    if (!a.employeeId) continue
    const set = absentByDate.get(a.date) ?? new Set<string>()
    set.add(a.employeeId)
    absentByDate.set(a.date, set)
  }

  const reported = new Set(reportDates)
  const queued = new Set(queuedDates)

  return days.map((date) => {
    const hours = hoursByDate.get(date) ?? 0
    const crewCount = crewByDate.get(date)?.size ?? 0
    const absentCount = absentByDate.get(date)?.size ?? 0
    const hasReport = reported.has(date)
    // A day where the whole crew was rained off is a LOGGED day — he reported it.
    const anything = hours > 0 || hasReport || absentCount > 0

    const status: DayStatus = queued.has(date) ? 'waiting' : anything ? 'sent' : 'none'

    return { date, weekday: weekdayOf(date), hours, crewCount, absentCount, hasReport, status }
  })
}

/** Days with nothing on them, oldest first — what the foreman still owes. */
export function missingDays(summaries: DaySummary[]): string[] {
  return summaries
    .filter((s) => s.status === 'none')
    .map((s) => s.date)
    .sort()
}

const num = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0)
