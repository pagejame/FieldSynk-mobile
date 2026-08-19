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
import { useFocusEffect, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { Screen } from '@/components/Screen'
import { supabase } from '@/lib/supabase'
import { getQueueCount, flushQueue } from '@/lib/offline-queue'
import { colors, fontSize, spacing, radius } from '@/lib/theme'

interface Job {
  id: string
  job_number: string
  job_name: string
  status: string
}

export default function JobsScreen() {
  const router = useRouter()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pending, setPending] = useState(0)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('jobs')
      .select('id, job_number, job_name, status')
      .eq('is_overhead', false)
      .order('job_number')
    setJobs((data ?? []) as Job[])
    setPending(await getQueueCount())
    setLoading(false)
    setRefreshing(false)
  }, [])

  async function syncNow() {
    await flushQueue()
    setPending(await getQueueCount())
  }

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Jobs</Text>
        <Text style={styles.subtitle}>
          Tap a job to log today&apos;s report. The clock shows what you&apos;ve sent; the mic walks you through the wrap-up.
        </Text>
      </View>

      {pending > 0 && (
        <TouchableOpacity style={styles.syncChip} onPress={syncNow} activeOpacity={0.7}>
          <Feather name="upload-cloud" size={14} color={colors.warning} />
          <Text style={styles.syncText}>
            {pending} report{pending === 1 ? '' : 's'} waiting to sync — tap to sync now
          </Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(j) => j.id}
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
          ListEmptyComponent={
            <Text style={styles.empty}>No jobs yet. Add jobs on fieldsynk.org.</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => router.push(`/log-today/${item.id}`)}
            >
              <View style={styles.cardMain}>
                <Text style={styles.jobNumber}>{item.job_number}</Text>
                <Text style={styles.jobName}>{item.job_name}</Text>
              </View>
              <View style={styles.cardRight}>
                <TouchableOpacity
                  onPress={() => router.push(`/history/${item.id}`)}
                  style={styles.micBtn}
                  activeOpacity={0.7}
                  hitSlop={8}
                  accessibilityLabel="See what you've sent on this job"
                >
                  <Feather name="clock" size={18} color={colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push(`/wrapup/${item.id}`)}
                  style={styles.micBtn}
                  activeOpacity={0.7}
                  hitSlop={8}
                  accessibilityLabel="Talk through today's wrap-up"
                >
                  <Feather name="mic" size={18} color={colors.primary} />
                </TouchableOpacity>
                <View
                  style={[
                    styles.statusPill,
                    item.status === 'active' ? styles.statusActive : styles.statusOther,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      item.status === 'active' ? styles.statusTextActive : styles.statusTextOther,
                    ]}
                  >
                    {item.status}
                  </Text>
                </View>
                <Feather name="chevron-right" size={20} color={colors.textMuted} />
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  syncChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  syncText: { flex: 1, fontSize: fontSize.xs, fontWeight: '600', color: colors.warning },
  list: { padding: spacing.md, gap: spacing.sm },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl, fontSize: fontSize.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardMain: { flex: 1, paddingRight: spacing.sm },
  jobNumber: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '700', letterSpacing: 0.5 },
  jobName: { fontSize: fontSize.lg, color: colors.textPrimary, fontWeight: '600', marginTop: 2 },
  cardRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  micBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  statusActive: { backgroundColor: colors.successSoft },
  statusOther: { backgroundColor: colors.surfaceHigh },
  statusText: { fontSize: fontSize.xs, fontWeight: '600', textTransform: 'capitalize' },
  statusTextActive: { color: colors.success },
  statusTextOther: { color: colors.textSecondary },
})
