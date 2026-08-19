import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as Speech from 'expo-speech'
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
import { sendWrapUp } from '@/lib/api'
import { putVoiceDraft } from '@/lib/voice-draft-store'
import { wrapUpQuestions } from '@/lib/wrapup'
import {
  startFlow,
  currentQuestion,
  withAnswer,
  withoutCurrentAnswer,
  canGoNext,
  next as nextQ,
  back as backQ,
  answerFor,
  isRequired,
  isFinished,
  missingRequired,
  canSubmit,
  progress,
  type FlowState,
} from '@/lib/wrapup-flow'
import { colors, fontSize, spacing, radius } from '@/lib/theme'

// The guided wrap-up: the app ASKS each question out loud and records the answer.
//
// Why this rather than one long recording. A foreman at the end of a shift
// forgets a section — usually safety, which is the one that matters most later.
// Asked one at a time, he cannot. And every answer arrives attached to a known
// question, so the extractor never has to work out which half of a ramble was
// about materials.
//
// The speech is ON-DEVICE. It works in a basement with no signal, costs nothing
// per use, and starts instantly — all three matter more here than a nicer voice.

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

export default function WrapUpScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>()
  const router = useRouter()
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)

  const [job, setJob] = useState<{ number: string; name: string } | null>(null)
  const [flow, setFlow] = useState<FlowState | null>(null)
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── load the job + build the run ──────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return
    void (async () => {
      const [{ data: j }, { data: co }] = await Promise.all([
        supabase.from('jobs').select('job_number, job_name').eq('id', jobId).maybeSingle(),
        supabase.from('companies').select('settings').maybeSingle(),
      ])
      if (j) setJob({ number: (j as { job_number: string }).job_number, name: (j as { job_name: string }).job_name })
      const matsOn =
        !!(co?.settings as { modules?: { materials?: boolean } } | null)?.modules?.materials
      setFlow(startFlow(wrapUpQuestions(matsOn)))
    })()
  }, [jobId])

  const q = flow ? currentQuestion(flow) : null

  /** Read the question aloud. */
  const ask = useCallback((text: string) => {
    void Speech.stop()
    Speech.speak(text, { rate: 0.95, pitch: 1.0 })
  }, [])

  // Ask each question as he arrives at it. This is the whole feature: he is
  // prompted rather than left to remember the list.
  useEffect(() => {
    if (!q) return
    ask(q.hint ? `${q.prompt} ${q.hint}` : q.prompt)
    return () => {
      void Speech.stop()
    }
  }, [q?.key, ask])

  // Stop talking the moment the screen goes away — nothing worse than a phone
  // still reading out questions in someone's pocket.
  useEffect(
    () => () => {
      void Speech.stop()
    },
    [],
  )

  useEffect(() => {
    if (recording) {
      setSeconds(0)
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } else if (timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [recording])

  async function startRec() {
    if (!flow) return
    setError(null)
    void Speech.stop() // never record the phone talking over him
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync()
      if (!perm.granted) {
        setError('Microphone access is off. Turn it on for FieldSynk in Settings.')
        return
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
      setRecording(true)
    } catch {
      setError("Couldn't start recording. Try again.")
    }
  }

  async function stopRec() {
    if (!flow) return
    setRecording(false)
    try {
      await recorder.stop()
      const uri = recorder.uri
      if (!uri) throw new Error('nothing captured')
      setFlow((f) => (f ? withAnswer(f, uri, seconds) : f))
    } catch {
      setError("That answer didn't record. Try it again.")
    }
  }

  async function send() {
    if (!flow || !jobId) return
    setError(null)
    setSending(true)
    try {
      const answers: { key: string; prompt: string; audioBase64: string }[] = []
      for (const q0 of flow.questions) {
        const a = answerFor(flow, q0.key)
        if (!a) continue
        const b64 = await FileSystem.readAsStringAsync(a.uri, {
          encoding: FileSystem.EncodingType.Base64,
        })
        answers.push({ key: q0.key, prompt: q0.prompt, audioBase64: b64 })
      }
      const res = await sendWrapUp(jobId, answers, 'audio/m4a')
      const date = todayIso()
      putVoiceDraft(jobId, date, res.draft)
      router.replace(`/log-today/${jobId}?date=${date}&fromVoice=1`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the wrap-up.")
    } finally {
      setSending(false)
    }
  }

  if (!flow) {
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.primary} />
      </Screen>
    )
  }

  const { answered, total } = progress(flow)
  const done = isFinished(flow)
  const answeredHere = q ? answerFor(flow, q.key) : null
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <Screen>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Feather name="chevron-left" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Daily wrap-up</Text>
          {job && (
            <Text style={styles.subtitle}>
              {job.number} · {job.name}
            </Text>
          )}
        </View>
      </View>

      {/* Progress — how much of the day is left to say. */}
      <View style={styles.progressRow}>
        {flow.questions.map((qq, i) => (
          <View
            key={qq.key}
            style={[
              styles.pip,
              answerFor(flow, qq.key) ? styles.pipDone : i === flow.index ? styles.pipHere : null,
            ]}
          />
        ))}
      </View>
      <Text style={styles.progressText}>
        {answered} of {total} answered
      </Text>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!done && q && (
          <>
            <View style={styles.qCard}>
              <View style={styles.qTop}>
                <Text style={styles.qNum}>
                  Question {flow.index + 1} of {total}
                </Text>
                <TouchableOpacity
                  onPress={() => ask(q.hint ? `${q.prompt} ${q.hint}` : q.prompt)}
                  hitSlop={10}
                  style={styles.repeat}
                >
                  <Feather name="volume-2" size={16} color={colors.primary} />
                  <Text style={styles.repeatText}>Say it again</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.qText}>{q.prompt}</Text>
              {!!q.hint && <Text style={styles.qHint}>{q.hint}</Text>}
              {!isRequired(q) && <Text style={styles.optional}>You can skip this one.</Text>}
            </View>

            <View style={styles.recArea}>
              {recording ? (
                <>
                  <TouchableOpacity style={styles.stopBtn} onPress={stopRec} activeOpacity={0.8}>
                    <Feather name="square" size={30} color="#fff" />
                  </TouchableOpacity>
                  <Text style={styles.timer}>
                    {mm}:{ss}
                  </Text>
                  <Text style={styles.hint}>Listening… tap when you&apos;re done.</Text>
                </>
              ) : answeredHere ? (
                <>
                  <View style={styles.answered}>
                    <Feather name="check" size={28} color={colors.success} />
                  </View>
                  <Text style={styles.hint}>Answer recorded ({answeredHere.seconds}s).</Text>
                  <TouchableOpacity
                    onPress={() => setFlow((f) => (f ? withoutCurrentAnswer(f) : f))}
                  >
                    <Text style={styles.redo}>Say it again</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity style={styles.micBtn} onPress={startRec} activeOpacity={0.8}>
                    <Feather name="mic" size={34} color="#fff" />
                  </TouchableOpacity>
                  <Text style={styles.hint}>Tap and answer.</Text>
                </>
              )}
            </View>

            <View style={styles.navRow}>
              <TouchableOpacity
                onPress={() => setFlow((f) => (f ? backQ(f) : f))}
                disabled={flow.index === 0 || recording}
                style={[styles.navBtn, (flow.index === 0 || recording) && styles.navOff]}
              >
                <Feather name="chevron-left" size={18} color={colors.textSecondary} />
                <Text style={styles.navText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setFlow((f) => (f ? nextQ(f) : f))}
                disabled={!canGoNext(flow) || recording}
                style={[styles.navBtn, styles.navNext, (!canGoNext(flow) || recording) && styles.navOff]}
              >
                <Text style={[styles.navText, styles.navNextText]}>
                  {answeredHere || !isRequired(q) ? 'Next' : 'Answer first'}
                </Text>
                <Feather name="chevron-right" size={18} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </>
        )}

        {done && (
          <View style={styles.doneCard}>
            <Text style={styles.doneTitle}>That&apos;s everything.</Text>
            {missingRequired(flow).length > 0 ? (
              <>
                <Text style={styles.doneWarn}>
                  Still needed: {missingRequired(flow).map((m) => m.prompt).join(' ')}
                </Text>
                <Button
                  label="Go back and answer"
                  variant="secondary"
                  onPress={() =>
                    setFlow((f) =>
                      f ? { ...f, index: f.questions.indexOf(missingRequired(f)[0]) } : f,
                    )
                  }
                />
              </>
            ) : (
              <Text style={styles.doneText}>
                {answered} answer{answered === 1 ? '' : 's'} ready. This fills in today&apos;s
                sheet — you&apos;ll check it before anything saves.
              </Text>
            )}
            <Button
              label={sending ? 'Sending…' : 'Send the wrap-up'}
              onPress={send}
              disabled={sending || !canSubmit(flow)}
              style={{ marginTop: spacing.md }}
            />
            <TouchableOpacity onPress={() => setFlow((f) => (f ? backQ(f) : f))}>
              <Text style={styles.redo}>Back to the last question</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  back: { padding: spacing.xs },
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 1 },

  progressRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  pip: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border },
  pipDone: { backgroundColor: colors.success },
  pipHere: { backgroundColor: colors.primary },
  progressText: {
    paddingHorizontal: spacing.md,
    paddingTop: 4,
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },

  body: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  errorBox: { backgroundColor: colors.errorSoft, borderRadius: radius.md, padding: spacing.sm },
  errorText: { color: colors.error, fontSize: fontSize.sm, fontWeight: '600' },

  qCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
  },
  qTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qNum: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  repeat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  repeatText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '600' },
  qText: { fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary, lineHeight: 28 },
  qHint: { fontSize: fontSize.md, color: colors.textSecondary, lineHeight: 21 },
  optional: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },

  recArea: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
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
  answered: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timer: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  hint: { fontSize: fontSize.md, color: colors.textSecondary, textAlign: 'center' },
  redo: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  navRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  navNext: { borderColor: colors.primary },
  navOff: { opacity: 0.4 },
  navText: { fontSize: fontSize.md, color: colors.textSecondary, fontWeight: '600' },
  navNextText: { color: colors.primary },

  doneCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  doneTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary },
  doneText: { fontSize: fontSize.md, color: colors.textSecondary, lineHeight: 21 },
  doneWarn: { fontSize: fontSize.md, color: colors.warning, fontWeight: '600', lineHeight: 21 },
})
