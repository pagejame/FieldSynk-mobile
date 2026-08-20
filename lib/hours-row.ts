// One row of the hours sheet, and what happens when the foreman edits it.
//
// The SERVER builds the sheet — it owns the job's schedule, the union rules and
// the crew. This is only what the phone needs to re-split a row the moment he
// changes it, so the figures on screen are the figures that get filed rather
// than something that catches up after a round trip.
//
// DELIBERATE DUPLICATE of the arithmetic in the web repo (hours-sheet.ts +
// schedule.ts). Only the parts a row needs are here, not the whole schedule
// engine. The tests are duplicated too: if the two ever disagree about a man's
// overtime, a test fails rather than a paycheque.

import { splitShortDay, type MissedFrom } from './short-day.ts'

export type SaturdayRule = 'straight' | 'ot' | 'dt'
export type SundayRule = 'ot' | 'dt'
export type HolidayRule = 'straight' | 'ot' | 'dt' | 'unpaid'

export interface DayRules {
  otDailyThreshold: number
  saturdayRule: SaturdayRule
  sundayRule: SundayRule
  holidayRule: HolidayRule
}

export interface HoursRow {
  employeeId: string
  name: string
  scheduledHours: number
  hoursMissed: number
  missedFrom: MissedFrom
  reason: string
  st: number
  ot: number
  dt: number
  /** The split had to assume which end of the day he missed. */
  assumedEnd: boolean
  costCodeId: string | null
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** 0 = Sunday. Parsed as UTC so the phone's own timezone cannot shift the day. */
export function dayOfWeek(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay()
}

/** Straight time up to the threshold, overtime after. */
function regularSplit(h: number, threshold: number) {
  const st = Math.min(h, threshold)
  return { st: round2(st), ot: round2(Math.max(0, h - threshold)), dt: 0 }
}

/**
 * A weekend or holiday premium REPLACES the whole day's split rather than
 * sitting inside it — a union Saturday is overtime from the first hour, so
 * there is no straight time for a late arrival to come off.
 */
function premiumSplit(h: number, rules: DayRules, dateIso: string, isHoliday: boolean) {
  if (h <= 0) return { st: 0, ot: 0, dt: 0 }

  if (isHoliday) {
    if (rules.holidayRule === 'dt') return { st: 0, ot: 0, dt: round2(h) }
    if (rules.holidayRule === 'ot') return { st: 0, ot: round2(h), dt: 0 }
    return regularSplit(h, rules.otDailyThreshold) // 'unpaid' = no premium
  }

  const dow = dayOfWeek(dateIso)
  if (dow === 0) {
    return rules.sundayRule === 'dt'
      ? { st: 0, ot: 0, dt: round2(h) }
      : { st: 0, ot: round2(h), dt: 0 }
  }
  if (dow === 6) {
    if (rules.saturdayRule === 'dt') return { st: 0, ot: 0, dt: round2(h) }
    if (rules.saturdayRule === 'ot') return { st: 0, ot: round2(h), dt: 0 }
    return { st: round2(h), ot: 0, dt: 0 } // 'straight'
  }
  return regularSplit(h, rules.otDailyThreshold)
}

export const isPremiumDay = (dateIso: string, isHoliday = false): boolean =>
  isHoliday || dayOfWeek(dateIso) === 0 || dayOfWeek(dateIso) === 6

/** Re-split a row after he changes the hours or which end of the day was missed. */
export function recalcRow(
  row: HoursRow,
  rules: DayRules,
  dateIso: string,
  isHoliday = false,
): HoursRow {
  const present = Math.max(0, round2(row.scheduledHours - row.hoursMissed))

  if (isPremiumDay(dateIso, isHoliday)) {
    const s = premiumSplit(present, rules, dateIso, isHoliday)
    return { ...row, st: s.st, ot: s.ot, dt: s.dt, assumedEnd: false }
  }

  const s = splitShortDay({
    scheduledHours: row.scheduledHours,
    hoursMissed: row.hoursMissed,
    otDailyThreshold: rules.otDailyThreshold,
    missedFrom: row.missedFrom,
  })
  return { ...row, st: s.st, ot: s.ot, dt: 0, assumedEnd: s.assumed }
}
