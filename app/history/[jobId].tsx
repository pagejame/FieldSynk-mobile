import { useCallback, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { Screen } from '@/components/Screen'
import { supabase } from '@/lib/supabase'
import { getQueuedDatesForJob } from '@/lib/offline-queue'
import {
  buildDayHistory,
  lastNDays,
  missingDays,
  type DaySummary,
} from '@/lib/day-history'
import { colors, fontSize, spacing, radius } from '@/lib/theme'

// The last two weeks on one job: what went in, what is still on the phone, and
// what has nothing on it at all. Tapping a day opens that day's report to fix.
//
// This exists because the log screen could always EDIT a past day — it has date
// arrows — but never showed which days were done. On a job where a missed day
// means a man goes unpaid, "did Tuesday go in?" is the question that matters, and
// the answer used to be a phone call to the office.

const DAYS_BACK = 14

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/** '18 Aug' — short enough for a phone row, unambiguous about the month. */
function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${months[(m ?? 1) - 1] ?? ''}`
}

export default function HistoryScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>()
  const router = useRouter()
  const [job, setJob] = useState<{ job_number: string; job_name: string } | null>(null)
  const [days, setDays] = useState<DaySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!jobId) return
    const window = lastNDays(todayIso(), DAYS_BACK)
    const from = window[window.length - 1]
    const to = window[0]

    const [{ data: jobRow }, { data: labor }, { data: absences }, { data: reports }, queuedDates] =
      await Promise.all([
        supabase.from('jobs').select('job_number, job_name').eq('id', jobId).maybeSingle(),
        supabase
          .from('labor_entries')
          .select('date, employee_id, hours_regular, hours_ot, hours_dt')
          .eq('job_id', jobId)
          .gte('date', from)
          .lte('date', to),
        supabase
          .from('absence_entries')
          .select('date, employee_id')
          .eq('job_id', jobId)
          .gte('date', from)
          .lte('date', to),
        supabase
          .from('daily_reports')
          .select('date')
          .eq('job_id', jobId)
          .gte('date', from)
          .lte('date', to),
        getQueuedDatesForJob(jobId),
      ])

    setJob((jobRow as { job_number: string; job_name: string } | null) ?? null)
    setDays(
      buildDayHistory({
        days: window,
        labor: (
          (labor ?? []) as {
            date: string
            employee_id: string | null
            hours_regular: number | null
            hours_ot: number | null
            hours_dt: number | null
          }[]
        ).map((l) => ({
          date: l.date,
          employeeId: l.employee_id,
          st: Number(l.hours_regular) || 0,
          ot: Number(l.hours_ot) || 0,
          dt: Number(l.hours_dt) || 0,
        })),
        absences: ((absences ?? []) as { date: string; employee_id: string | null }[]).map((a) => ({
          date: a.date,
          employeeId: a.employee_id,
        })),
        reportDates: ((reports ?? []) as { date: string }[]).map((r) => r.date),
        queuedDates,
      }),
    )
    setLoading(false)
    setRefreshing(false)
  }, [jobId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const gaps = missingDays(days)
  const waiting = days.filter((d) => d.status === 'waiting').length

  return (
    <Screen>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Feather name="chevron-left" size={22} color={colors.textSecondary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>What you&apos;ve sent</Text>
        <Text style={styles.subtitle}>
          {job ? `${job.job_number} — ${job.job_name}` : 'Last two weeks'}
        </Text>
      </View>

      {/* One line telling him whether anything needs doing. */}
      {!loading && (
        <View style={styles.banner}>
          {waiting > 0 ? (
            <Text style={[styles.bannerText, { color: colors.warning }]}>
              {waiting} {waiting === 1 ? 'day is' : 'days are'} still waiting to send. Pull down to
              retry.
            </Text>
          ) : gaps.length > 0 ? (
            <Text style={[styles.bannerText, { color: colors.textSecondary }]}>
              {gaps.length} {gaps.length === 1 ? 'day has' : 'days have'} nothing logged. Tap one to
              fill it in.
            </Text>
          ) : (
            <Text style={[styles.bannerText, { color: colors.success }]}>
              Every day in the last two weeks is in.
            </Text>
          )}
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
      ) : (
        <FlatList
          data={days}
          keyExtractor={(d) => d.date}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true)
                void load()
              }}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push(`/log-today/${jobId}?date=${item.date}`)}
              accessibilityLabel={`${item.weekday} ${dayLabel(item.date)}, ${statusWord(item)}`}
            >
              <View style={styles.dateCol}>
                <Text style={styles.weekday}>{item.weekday}</Text>
                <Text style={styles.date}>{dayLabel(item.date)}</Text>
              </View>

              <View style={styles.middle}>
                <Text style={styles.summary}>{summaryLine(item)}</Text>
                {item.absentCount > 0 && (
                  <Text style={styles.absent}>
                    {item.absentCount} out
                  </Text>
                )}
              </View>

              <StatusPill status={item.status} />
              <Feather name="chevron-right" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}
    </Screen>
  )
}

function summaryLine(d: DaySummary): string {
  if (d.status === 'none') return 'Nothing logged'
  const bits: string[] = []
  if (d.hours > 0) bits.push(`${d.hours} hrs`)
  if (d.crewCount > 0) bits.push(`${d.crewCount} ${d.crewCount === 1 ? 'man' : 'men'}`)
  if (bits.length === 0 && d.hasReport) bits.push('Work written up')
  if (bits.length === 0) bits.push('Reported')
  return bits.join(' · ')
}

function statusWord(d: DaySummary): string {
  return d.status === 'sent' ? 'sent' : d.status === 'waiting' ? 'waiting to send' : 'nothing logged'
}

function StatusPill({ status }: { status: DaySummary['status'] }) {
  const map = {
    sent: { label: 'Sent', color: colors.success, bg: colors.successSoft },
    waiting: { label: 'Waiting', color: colors.warning, bg: 'rgba(217, 119, 6, 0.12)' },
    none: { label: '—', color: colors.textMuted, bg: 'transparent' },
  } as const
  const s = map[status]
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <Text style={[styles.pillText, { color: s.color }]}>{s.label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  backText: { color: colors.textSecondary, fontSize: fontSize.md },
  title: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },

  banner: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  bannerText: { fontSize: fontSize.sm, fontWeight: '600' },

  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  dateCol: { width: 52 },
  weekday: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  date: { fontSize: fontSize.xs, color: colors.textMuted },
  middle: { flex: 1 },
  summary: { fontSize: fontSize.md, color: colors.textPrimary },
  absent: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  pillText: { fontSize: fontSize.xs, fontWeight: '700' },
})
