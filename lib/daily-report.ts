// Same idempotent write-planning logic as the web app's Unified Daily Report.
// Saving the same screen twice must never change the data twice — the payroll
// trust gate. Rows loaded from (or already saved to) the database carry an id;
// on save an id means UPDATE (or DELETE when cleared), and only new rows INSERT.
// After an insert the caller writes the returned id back, so a second save
// updates the same row instead of duplicating it.

export const round2 = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100

export type RowAction = 'insert' | 'update' | 'delete' | 'noop'

export function rowAction(existingId: string | null, hasContent: boolean): RowAction {
  if (existingId) return hasContent ? 'update' : 'delete'
  return hasContent ? 'insert' : 'noop'
}

export const hourVal = (v: number | string): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export interface LaborLine {
  existingId: string | null
  st: number
  ot: number
  dt: number
}

export const laborTotal = (l: { st: number; ot: number; dt: number }): number =>
  round2(hourVal(l.st) + hourVal(l.ot) + hourVal(l.dt))

export const laborAction = (l: LaborLine): RowAction =>
  rowAction(l.existingId, laborTotal(l) > 0)

export function persistedLaborTotal(lines: LaborLine[]): number {
  return round2(
    lines.reduce((sum, l) => {
      const a = laborAction(l)
      return a === 'insert' || a === 'update' ? sum + laborTotal(l) : sum
    }, 0),
  )
}

export function validQuantity(v: number | string): boolean {
  if (typeof v === 'string' && v.trim() === '') return false
  const n = typeof v === 'number' ? v : Number(v.trim())
  return Number.isFinite(n) && n >= 0
}
