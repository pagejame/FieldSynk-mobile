import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import {
  useAudioRecorder,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
} from 'expo-audio'
import * as FileSystem from 'expo-file-system/legacy'
import { Screen } from '@/components/Screen'
import { Button } from '@/components/Button'
import { supabase } from '@/lib/supabase'
import { transcribeVoice, type VoiceResult } from '@/lib/api'
import { putVoiceDraft, clearVoiceDraft } from '@/lib/voice-draft-store'
import { colors, fontSize, spacing, radius } from '@/lib/theme'

type Phase = 'idle' | 'recording' | 'processing' | 'result'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

export default function VoiceScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>()
  const router = useRouter()
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)

  const [job, setJob] = useState<{ number: string; name: string } | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VoiceResult | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    void supabase
      .from('jobs')
      .select('job_number, job_name')
      .eq('id', jobId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setJob({ number: data.job_number as string, name: data.job_name as string })
      })
  }, [jobId])

  // Recording timer.
  useEffect(() => {
    if (phase === 'recording') {
      setSeconds(0)
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } else if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [phase])

  const startRecording = useCallback(async () => {
    setError(null)
    setResult(null)
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync()
      if (!perm.granted) {
        setError('Microphone access is off. Turn it on for FieldSynk in Settings.')
        return
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
      setPhase('recording')
    } catch {
      setError("Couldn't start recording. Try again.")
    }
  }, [recorder])

  const stopAndSend = useCallback(async () => {
    setPhase('processing')
    try {
      await recorder.stop()
      const uri = recorder.uri
      if (!uri) throw new Error('No recording was captured.')
      const audioBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
      const res = await transcribeVoice(jobId, audioBase64, 'audio/m4a')
      setResult(res)
      setPhase('result')
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't process the recording.")
      setPhase('idle')
    }
  }, [recorder, jobId])

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <Screen>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Speak the report</Text>
          {job && (
            <Text style={styles.subtitle}>
              {job.number} · {job.name}
            </Text>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {phase !== 'result' && (
          <View style={styles.recordArea}>
            {phase === 'processing' ? (
              <>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.hint}>Transcribing and reading it back…</Text>
              </>
            ) : phase === 'recording' ? (
              <>
                <TouchableOpacity style={styles.stopBtn} onPress={stopAndSend} activeOpacity={0.8}>
                  <Feather name="square" size={30} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.timer}>
                  {mm}:{ss}
                </Text>
                <Text style={styles.hint}>Recording… tap to finish.</Text>
              </>
            ) : (
              <>
                <TouchableOpacity style={styles.micBtn} onPress={startRecording} activeOpacity={0.8}>
                  <Feather name="mic" size={34} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.hint}>
                  Tap and say who&apos;s out, what the crew did, any material, holdups, and safety.
                  About 90 seconds.
                </Text>
              </>
            )}
          </View>
        )}

        {phase === 'result' && result && (
          <View style={styles.result}>
            <View style={styles.resultHeader}>
              <Text style={styles.resultTitle}>Read it back — check before you enter it</Text>
              <TouchableOpacity
                onPress={() => {
                  clearVoiceDraft()
                  setPhase('idle')
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.redo}>Redo</Text>
              </TouchableOpacity>
            </View>

            {!result.extracted && (
              <View style={styles.warnBox}>
                <Text style={styles.warnText}>
                  Transcribed, but the structured read-back isn&apos;t on yet. Your words are below.
                </Text>
              </View>
            )}

            {!!result.draft.workPerformed && <Field label="Work performed" value={result.draft.workPerformed} />}
            {!!result.draft.crewNote && <Field label="Crew" value={result.draft.crewNote} />}
            {result.draft.absences.length > 0 && (
              <Field
                label="Absences"
                value={result.draft.absences.map((a) => `• ${a.name}${a.reason ? ` — ${a.reason}` : ''}`).join('\n')}
              />
            )}
            {result.draft.materials.length > 0 && (
              <Field
                label="Materials"
                value={result.draft.materials
                  .map((m) => `• ${m.name}${m.quantity != null ? ` — ${m.quantity}${m.unit ? ` ${m.unit}` : ''}` : ''}`)
                  .join('\n')}
              />
            )}
            {!!result.draft.holdups && <Field label="Holdups" value={result.draft.holdups} />}
            {!!result.draft.safety && <Field label="Safety" value={result.draft.safety} />}

            <Field label="What you said" value={result.transcript} muted />

            {/* The whole point: the timesheet opens already filled in from what he
                said. Before this, the draft was read back and then discarded, and
                he retyped the lot. */}
            <Button
              label="Fill in today's sheet"
              onPress={() => {
                const date = todayIso()
                putVoiceDraft(jobId, date, result.draft)
                router.replace(`/log-today/${jobId}?date=${date}&fromVoice=1`)
              }}
              style={{ marginTop: spacing.md }}
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, muted && styles.fieldValueMuted]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  back: { padding: spacing.xs },
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },
  body: { padding: spacing.md, paddingBottom: spacing.xxl },
  errorBox: {
    backgroundColor: colors.errorSoft,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.error, fontSize: fontSize.sm, fontWeight: '600' },
  recordArea: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
  micBtn: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBtn: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timer: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  hint: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    lineHeight: 20,
  },
  result: { gap: spacing.md },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  redo: { fontSize: fontSize.sm, fontWeight: '600', color: colors.primary },
  warnBox: { backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: spacing.sm },
  warnText: { color: colors.warning, fontSize: fontSize.sm },
  field: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  fieldLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldValue: { fontSize: fontSize.md, color: colors.textPrimary, marginTop: 4, lineHeight: 20 },
  fieldValueMuted: { color: colors.textSecondary },
})
