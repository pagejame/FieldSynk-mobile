import { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { Screen } from '@/components/Screen'
import { Button } from '@/components/Button'
import { supabase } from '@/lib/supabase'
import { colors, fontSize, spacing, radius } from '@/lib/theme'
import { validQuantity, persistedLaborTotal } from '@/lib/daily-report'
import { applyReport } from '@/lib/apply-report'
import { enqueueReport } from '@/lib/offline-queue'
import { useNetworkStatus } from '@/lib/use-network'

// ── date helpers (no timezone drift) ──────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0')
function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function shiftDay(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + delta * 86400000
  const nd = new Date(t)
  return `${nd.getUTCFullYear()}-${pad(nd.getUTCMonth() + 1)}-${pad(nd.getUTCDate())}`
}
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${m}/${d}/${y}`
}
const numVal = (v: string): number => {
  const x = Number(v)
  return Number.isFinite(x) && x >= 0 ? x : 0
}

interface CrewRow {
  employeeId: string
  name: string
  laborIds: string[]
  costCodeId: string | null
  st: number
  ot: number
  dt: number
  locked: boolean
  out: boolean
  absenceId: string | null
  reason: string
  hoursMissed: string
}
interface MaterialRow {
  key: string
  existingId: string | null
  name: string
  qty: string
  unit: string
}

export default function LogTodayScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>()
  const router = useRouter()

  const [job, setJob] = useState<{ job_number: string; job_name: string } | null>(null)
  const [materialsEnabled, setMaterialsEnabled] = useState(false)
  const [date, setDate] = useState(todayIso)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const online = useNetworkStatus()
  const [crew, setCrew] = useState<CrewRow[]>([])
  const [work, setWork] = useState('')
  const [notes, setNotes] = useState('')
  const [materials, setMaterials] = useState<MaterialRow[]>([])
  const [seq, setSeq] = useState(0)

  const load = useCallback(
    async (forDate: string) => {
      if (!jobId) return
      setLoading(true)
      const [{ data: j }, { data: roster }, { data: co }, { data: cm }] = await Promise.all([
        supabase.from('jobs').select('job_number, job_name').eq('id', jobId).maybeSingle(),
        supabase.from('employees').select('id, name').eq('status', 'active').order('name'),
        supabase.from('companies').select('settings').maybeSingle(),
        // The crew assigned to THIS job (across its crews), so the foreman sees
        // their 6 workers, not the whole company. Falls back to the full roster.
        supabase
          .from('job_crew_members')
          .select('employee_id, employees(name), job_crews!inner(job_id)')
          .eq('job_crews.job_id', jobId),
      ])
      const matsOn =
        !!(co?.settings as { modules?: { materials?: boolean } } | null)?.modules?.materials
      setJob(j as { job_number: string; job_name: string } | null)
      setMaterialsEnabled(matsOn)

      // Prefer the job's crew (deduped); if no crew is set up, use the active roster.
      const seenEmp = new Set<string>()
      const jobCrew: { id: string; name: string }[] = []
      for (const m of (cm ?? []) as unknown as {
        employee_id: string | null
        employees: { name: string } | null
      }[]) {
        if (m.employee_id && !seenEmp.has(m.employee_id)) {
          seenEmp.add(m.employee_id)
          jobCrew.push({ id: m.employee_id, name: m.employees?.name ?? '' })
        }
      }
      jobCrew.sort((a, b) => a.name.localeCompare(b.name))
      const effectiveRoster =
        jobCrew.length > 0 ? jobCrew : ((roster ?? []) as { id: string; name: string }[])

      const [{ data: lab }, { data: rep }, { data: abs }, mat] = await Promise.all([
        supabase
          .from('labor_entries')
          .select('id, employee_id, cost_code_id, hours_regular, hours_ot, hours_dt')
          .eq('job_id', jobId)
          .eq('date', forDate),
        supabase
          .from('daily_reports')
          .select('id, work_performed, notes')
          .eq('job_id', jobId)
          .eq('date', forDate)
          .order('id')
          .limit(1),
        supabase
          .from('absence_entries')
          .select('id, employee_id, employee_name, reason, hours_missed')
          .eq('job_id', jobId)
          .eq('date', forDate),
        matsOn
          ? supabase
              .from('material_entries')
              .select('id, material_name, quantity, unit')
              .eq('job_id', jobId)
              .eq('date', forDate)
          : Promise.resolve({ data: [] as unknown[] }),
      ])

      // Group existing labor by employee.
      const byEmp = new Map<
        string,
        { ids: string[]; st: number; ot: number; dt: number; code: string | null }
      >()
      for (const r of (lab ?? []) as {
        id: string
        employee_id: string | null
        cost_code_id: string | null
        hours_regular: number | null
        hours_ot: number | null
        hours_dt: number | null
      }[]) {
        const key = r.employee_id ?? '__unassigned__'
        const cur = byEmp.get(key) ?? { ids: [], st: 0, ot: 0, dt: 0, code: null }
        cur.ids.push(r.id)
        cur.st += Number(r.hours_regular) || 0
        cur.ot += Number(r.hours_ot) || 0
        cur.dt += Number(r.hours_dt) || 0
        cur.code = cur.code ?? r.cost_code_id
        byEmp.set(key, cur)
      }
      const absByEmp = new Map<
        string,
        { id: string; reason: string; hours: string }
      >()
      for (const a of (abs ?? []) as {
        id: string
        employee_id: string | null
        employee_name: string | null
        reason: string | null
        hours_missed: number | null
      }[]) {
        if (a.employee_id)
          absByEmp.set(a.employee_id, {
            id: a.id,
            reason: a.reason ?? '',
            hours: a.hours_missed == null ? '' : String(a.hours_missed),
          })
      }

      const rows: CrewRow[] = effectiveRoster.map((e) => {
        const l = byEmp.get(e.id)
        const ab = absByEmp.get(e.id)
        return {
          employeeId: e.id,
          name: e.name,
          laborIds: l?.ids ?? [],
          costCodeId: l?.code ?? null,
          st: l?.st ?? 0,
          ot: l?.ot ?? 0,
          dt: l?.dt ?? 0,
          locked: (l?.ids.length ?? 0) > 1, // desktop split — don't overwrite from mobile
          out: !!ab,
          absenceId: ab?.id ?? null,
          reason: ab?.reason ?? '',
          hoursMissed: ab?.hours ?? '',
        }
      })

      const repRow = ((rep ?? []) as { id: string; work_performed: string | null; notes: string | null }[])[0]
      setWork(repRow?.work_performed ?? '')
      setNotes(repRow?.notes ?? '')
      setCrew(rows)
      setMaterials(
        ((mat.data ?? []) as {
          id: string
          material_name: string | null
          quantity: number | null
          unit: string | null
        }[]).map((m) => ({
          key: `e${m.id}`,
          existingId: m.id,
          name: m.material_name ?? '',
          qty: m.quantity == null ? '' : String(m.quantity),
          unit: m.unit ?? '',
        })),
      )
      setLoading(false)
    },
    [jobId],
  )

  useEffect(() => {
    void load(date)
  }, [date, load])

  function patchCrew(employeeId: string, patch: Partial<CrewRow>) {
    setCrew((p) => p.map((r) => (r.employeeId === employeeId ? { ...r, ...patch } : r)))
  }
  function addMaterial() {
    setMaterials((p) => [
      ...p,
      { key: `n${seq}`, existingId: null, name: '', qty: '', unit: '' },
    ])
    setSeq((s) => s + 1)
  }
  function patchMaterial(key: string, patch: Partial<MaterialRow>) {
    setMaterials((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const dayTotal = persistedLaborTotal(
    crew.filter((r) => !r.out).map((r) => ({ existingId: r.laborIds[0] ?? null, st: r.st, ot: r.ot, dt: r.dt })),
  )

  async function saveAll() {
    for (const m of materials) {
      if (m.name.trim() !== '' && !validQuantity(m.qty)) {
        Alert.alert('Check materials', 'Every material needs a quantity of 0 or more.')
        return
      }
    }
    setSaving(true)

    const payload = {
      jobId: jobId as string,
      date,
      crew: crew.map((r) => ({
        employeeId: r.employeeId,
        name: r.name,
        out: r.out,
        reason: r.reason,
        hoursMissed: r.hoursMissed,
        st: r.st,
        ot: r.ot,
        dt: r.dt,
        costCodeId: r.costCodeId,
        locked: r.locked,
      })),
      work,
      notes,
      materials: materials.map((m) => ({ name: m.name, qty: m.qty, unit: m.unit })),
      materialsEnabled,
    }

    const queueIt = async (reason: 'offline' | 'dropped') => {
      await enqueueReport(payload)
      setSaving(false)
      Alert.alert(
        'Saved on your phone',
        reason === 'offline'
          ? "No signal — this report syncs automatically when you're back online."
          : "Lost signal mid-save — this report syncs automatically when you're back online.",
        [{ text: 'OK', onPress: () => router.back() }],
      )
    }

    // Known offline → don't even try; keep it safe on the device.
    if (!online) {
      await queueIt('offline')
      return
    }

    try {
      const { errors } = await applyReport(payload)
      setSaving(false)
      if (errors.length === 0) {
        Alert.alert('Saved', "Today's report is saved.", [{ text: 'OK', onPress: () => router.back() }])
      } else {
        Alert.alert('Partly saved', `Couldn't save: ${errors.join(', ')}. Check the entries and Save again.`)
      }
    } catch {
      // Signal dropped mid-save — queue and sync later.
      await queueIt('dropped')
    }
  }

  if (loading) {
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: spacing.xxl }} color={colors.primary} />
      </Screen>
    )
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <Feather name="chevron-left" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <View style={styles.headerMain}>
            <Text style={styles.jobNumber} numberOfLines={1}>
              {job?.job_number} · {job?.job_name}
            </Text>
            <Text style={styles.title}>Log today</Text>
          </View>
        </View>

        {/* Date stepper */}
        <View style={styles.dateRow}>
          <TouchableOpacity onPress={() => setDate((d) => shiftDay(d, -1))} style={styles.dateBtn}>
            <Feather name="chevron-left" size={18} color={colors.primary} />
          </TouchableOpacity>
          <Text style={styles.dateText}>{prettyDate(date)}</Text>
          <TouchableOpacity
            onPress={() => setDate((d) => (d < todayIso() ? shiftDay(d, 1) : d))}
            style={styles.dateBtn}
          >
            <Feather name="chevron-right" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Crew */}
          <Text style={styles.sectionTitle}>Crew &amp; hours</Text>
          {crew.length === 0 ? (
            <Text style={styles.muted}>No crew on the roster yet.</Text>
          ) : (
            crew.map((r) => (
              <View key={r.employeeId} style={styles.crewCard}>
                <View style={styles.crewTop}>
                  <Text style={styles.crewName}>{r.name}</Text>
                  {!r.locked && (
                    <TouchableOpacity
                      onPress={() => patchCrew(r.employeeId, { out: !r.out })}
                      style={[styles.outBtn, r.out && styles.outBtnOn]}
                    >
                      <Text style={[styles.outText, r.out && styles.outTextOn]}>
                        {r.out ? 'Out today' : 'Mark out'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {r.locked ? (
                  <Text style={styles.muted}>
                    {r.st + r.ot + r.dt} hrs logged (split — edit on fieldsynk.org)
                  </Text>
                ) : r.out ? (
                  <View style={styles.outRow}>
                    <TextInput
                      style={[styles.hourInput, styles.reasonInput]}
                      placeholder="Reason (sick, excused…)"
                      placeholderTextColor={colors.textMuted}
                      value={r.reason}
                      onChangeText={(v) => patchCrew(r.employeeId, { reason: v })}
                    />
                    <TextInput
                      style={styles.hourInput}
                      placeholder="Hrs"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                      value={r.hoursMissed}
                      onChangeText={(v) => patchCrew(r.employeeId, { hoursMissed: v })}
                    />
                  </View>
                ) : (
                  <View style={styles.hoursRow}>
                    <HourField label="ST" value={r.st} onChange={(v) => patchCrew(r.employeeId, { st: v })} />
                    <HourField label="OT" value={r.ot} onChange={(v) => patchCrew(r.employeeId, { ot: v })} />
                    <HourField label="DT" value={r.dt} onChange={(v) => patchCrew(r.employeeId, { dt: v })} />
                  </View>
                )}
              </View>
            ))
          )}
          <Text style={styles.total}>Hours today: {dayTotal}</Text>

          {/* Work performed */}
          <Text style={styles.sectionTitle}>Work performed</Text>
          <TextInput
            style={styles.textArea}
            placeholder="What the crew got done today…"
            placeholderTextColor={colors.textMuted}
            multiline
            value={work}
            onChangeText={setWork}
          />
          <TextInput
            style={[styles.textArea, { minHeight: 56 }]}
            placeholder="Notes (optional)"
            placeholderTextColor={colors.textMuted}
            multiline
            value={notes}
            onChangeText={setNotes}
          />

          {/* Materials */}
          {materialsEnabled && (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>Materials used</Text>
                <TouchableOpacity onPress={addMaterial}>
                  <Text style={styles.addLink}>+ Add</Text>
                </TouchableOpacity>
              </View>
              {materials.length === 0 ? (
                <Text style={styles.muted}>None logged.</Text>
              ) : (
                materials.map((m) => (
                  <View key={m.key} style={styles.matRow}>
                    <TextInput
                      style={[styles.hourInput, { flex: 2 }]}
                      placeholder="Material"
                      placeholderTextColor={colors.textMuted}
                      value={m.name}
                      onChangeText={(v) => patchMaterial(m.key, { name: v })}
                    />
                    <TextInput
                      style={[styles.hourInput, { flex: 1 }]}
                      placeholder="Qty"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="decimal-pad"
                      value={m.qty}
                      onChangeText={(v) => patchMaterial(m.key, { qty: v })}
                    />
                    <TextInput
                      style={[styles.hourInput, { flex: 1 }]}
                      placeholder="Unit"
                      placeholderTextColor={colors.textMuted}
                      value={m.unit}
                      onChangeText={(v) => patchMaterial(m.key, { unit: v })}
                    />
                  </View>
                ))
              )}
            </>
          )}

          <View style={{ height: spacing.md }} />
        </ScrollView>

        {/* Save bar */}
        <View style={styles.saveBar}>
          <Button
            label={saving ? 'Saving…' : "Save today's report"}
            onPress={saveAll}
            loading={saving}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function HourField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <View style={styles.hourField}>
      <Text style={styles.hourLabel}>{label}</Text>
      <TextInput
        style={styles.hourInput}
        placeholder="0"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        value={value === 0 ? '' : String(value)}
        onChangeText={(v) => onChange(numVal(v))}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  back: { padding: spacing.xs },
  headerMain: { flex: 1, paddingLeft: spacing.xs },
  jobNumber: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600' },
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  dateBtn: { padding: spacing.xs, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  dateText: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary, minWidth: 110, textAlign: 'center' },
  scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.md,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  addLink: { color: colors.primary, fontWeight: '700', fontSize: fontSize.md, marginTop: spacing.md },
  muted: { color: colors.textMuted, fontSize: fontSize.sm },
  crewCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  crewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  crewName: { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  outBtn: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceHigh },
  outBtnOn: { backgroundColor: colors.warningSoft },
  outText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.textSecondary },
  outTextOn: { color: colors.warning },
  hoursRow: { flexDirection: 'row', gap: spacing.sm },
  hourField: { flex: 1, alignItems: 'center' },
  hourLabel: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600', marginBottom: 2 },
  hourInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: fontSize.md,
    textAlign: 'center',
    minWidth: 56,
    flexGrow: 1,
  },
  outRow: { flexDirection: 'row', gap: spacing.sm },
  reasonInput: { flex: 3, textAlign: 'left' },
  total: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.sm },
  textArea: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    color: colors.textPrimary,
    fontSize: fontSize.md,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  matRow: { flexDirection: 'row', gap: spacing.sm },
  saveBar: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
})
