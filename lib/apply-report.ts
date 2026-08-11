import { supabase } from './supabase'
import { laborAction, rowAction, validQuantity } from './daily-report'

// Applies a whole day's report (crew hours/absences, work performed, materials) to
// the FieldSynk backend. It re-reads the day's existing rows every time it runs and
// reconciles to the desired state, so it is IDEMPOTENT: calling it twice with the
// same payload never doubles anything. That property is what lets the offline queue
// safely replay a queued report when the phone gets signal back.

const numVal = (v: string): number => {
  const x = Number(v)
  return Number.isFinite(x) && x >= 0 ? x : 0
}

export interface ReportCrewRow {
  employeeId: string
  name: string
  out: boolean
  reason: string
  hoursMissed: string
  st: number
  ot: number
  dt: number
  costCodeId: string | null
  locked: boolean
}
export interface ReportMaterialRow {
  name: string
  qty: string
  unit: string
}
export interface DayReportPayload {
  jobId: string
  date: string
  crew: ReportCrewRow[]
  work: string
  notes: string
  materials: ReportMaterialRow[]
  materialsEnabled: boolean
}

export async function applyReport(p: DayReportPayload): Promise<{ errors: string[] }> {
  const errors: string[] = []

  const [{ data: lab }, { data: rep }, { data: abs }, matRes] = await Promise.all([
    supabase
      .from('labor_entries')
      .select('id, employee_id, cost_code_id, hours_regular, hours_ot, hours_dt')
      .eq('job_id', p.jobId)
      .eq('date', p.date),
    supabase
      .from('daily_reports')
      .select('id')
      .eq('job_id', p.jobId)
      .eq('date', p.date)
      .order('id')
      .limit(1),
    supabase
      .from('absence_entries')
      .select('id, employee_id')
      .eq('job_id', p.jobId)
      .eq('date', p.date),
    p.materialsEnabled
      ? supabase.from('material_entries').select('id').eq('job_id', p.jobId).eq('date', p.date)
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  // existing labor ids grouped by employee (multiple = a desktop split → left alone)
  const laborByEmp = new Map<string, string[]>()
  for (const r of (lab ?? []) as { id: string; employee_id: string | null }[]) {
    if (!r.employee_id) continue
    const arr = laborByEmp.get(r.employee_id) ?? []
    arr.push(r.id)
    laborByEmp.set(r.employee_id, arr)
  }
  const absByEmp = new Map<string, string>()
  for (const a of (abs ?? []) as { id: string; employee_id: string | null }[]) {
    if (a.employee_id) absByEmp.set(a.employee_id, a.id)
  }

  // ── crew ────────────────────────────────────────────────────────────────
  for (const row of p.crew) {
    if (row.locked) continue
    const laborIds = laborByEmp.get(row.employeeId) ?? []
    const laborId = laborIds.length === 1 ? laborIds[0] : null
    if (laborIds.length > 1) continue // a split slipped through — never overwrite it
    const absenceId = absByEmp.get(row.employeeId) ?? null

    if (row.out) {
      if (laborId) {
        const { error } = await supabase.from('labor_entries').delete().eq('id', laborId)
        if (error) errors.push(`${row.name} hours`)
      }
      const payload = {
        job_id: p.jobId,
        date: p.date,
        employee_id: row.employeeId,
        employee_name: row.name,
        reason: row.reason.trim() || null,
        hours_missed: row.hoursMissed.trim() === '' ? null : numVal(row.hoursMissed),
      }
      if (absenceId) {
        const { error } = await supabase.from('absence_entries').update(payload).eq('id', absenceId)
        if (error) errors.push(`${row.name} absence`)
      } else {
        const { error } = await supabase.from('absence_entries').insert(payload)
        if (error) errors.push(`${row.name} absence`)
      }
    } else {
      if (absenceId) await supabase.from('absence_entries').delete().eq('id', absenceId)
      const action = laborAction({ existingId: laborId, st: row.st, ot: row.ot, dt: row.dt })
      if (action === 'insert') {
        const { error } = await supabase.from('labor_entries').insert({
          job_id: p.jobId,
          date: p.date,
          employee_id: row.employeeId,
          cost_code_id: row.costCodeId,
          hours_regular: row.st,
          hours_ot: row.ot,
          hours_dt: row.dt,
        })
        if (error) errors.push(`${row.name} hours`)
      } else if (action === 'update' && laborId) {
        const { error } = await supabase
          .from('labor_entries')
          .update({ hours_regular: row.st, hours_ot: row.ot, hours_dt: row.dt })
          .eq('id', laborId)
        if (error) errors.push(`${row.name} hours`)
      } else if (action === 'delete' && laborId) {
        const { error } = await supabase.from('labor_entries').delete().eq('id', laborId)
        if (error) errors.push(`${row.name} hours`)
      }
    }
  }

  // ── work performed (one report per job-day) ──────────────────────────────
  const reportId = ((rep ?? []) as { id: string }[])[0]?.id ?? null
  const repAction = rowAction(reportId, p.work.trim() !== '')
  if (repAction === 'insert') {
    const { error } = await supabase
      .from('daily_reports')
      .insert({ job_id: p.jobId, date: p.date, work_performed: p.work.trim() || null, notes: p.notes.trim() || null })
    if (error) errors.push('work performed')
  } else if (repAction === 'update' && reportId) {
    const { error } = await supabase
      .from('daily_reports')
      .update({ work_performed: p.work.trim() || null, notes: p.notes.trim() || null })
      .eq('id', reportId)
    if (error) errors.push('work performed')
  } else if (repAction === 'delete' && reportId) {
    const { error } = await supabase.from('daily_reports').delete().eq('id', reportId)
    if (error) errors.push('work performed')
  }

  // ── materials: replace the day's set (idempotent without carrying row ids) ─
  if (p.materialsEnabled) {
    const wanted = p.materials.filter((m) => m.name.trim() !== '' && validQuantity(m.qty))
    const existingMatIds = ((matRes.data ?? []) as { id: string }[]).map((m) => m.id)
    if (existingMatIds.length > 0) {
      const { error } = await supabase.from('material_entries').delete().in('id', existingMatIds)
      if (error) errors.push('materials')
    }
    if (wanted.length > 0) {
      const { error } = await supabase.from('material_entries').insert(
        wanted.map((m) => ({
          job_id: p.jobId,
          date: p.date,
          material_name: m.name.trim(),
          quantity: Number(m.qty),
          unit: m.unit.trim() || null,
        })),
      )
      if (error) errors.push('materials')
    }
  }

  return { errors }
}
