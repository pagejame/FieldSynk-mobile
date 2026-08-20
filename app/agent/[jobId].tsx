import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Speech from 'expo-speech'
import * as FileSystem from 'expo-file-system/legacy'
import {
  useAudioRecorder,
  RecordingPresets,
  AudioModule,
  setAudioModeAsync,
} from 'expo-audio'
import { Screen } from '@/components/Screen'
import { supabase } from '@/lib/supabase'
import { sendTurn, finishAgentWrapUp } from '@/lib/api'
import { putVoiceDraft } from '@/lib/voice-draft-store'
import { WRAPUP_QUESTIONS } from '@/lib/wrapup'
import { WrapUpReview, type CostCodeOption } from '@/components/WrapUpReview'
import type { HoursRow, DayRules } from '@/lib/hours-row'
import { colors, spacing, radius, fontSize } from '@/lib/theme'
import {
  startCall,
  afterTurn,
  afterSpeaking,
  afterListening,
  type CallState,
} from '@/lib/agent-call'

// The wrap-up as a conversation.
//
// The agent asks, he answers, it asks about what he said. He taps once to say
// he has finished talking — the phone starts listening on its own the moment the
// agent stops, because he is holding it with gloves on and every extra tap is a
// tap in the rain.
//
// The screen shows the conversation as it happens. Not decoration: it is where
// he sees that it heard "Kowalski" and not "Kowalsky". A wrong name caught here
// costs nothing; the same name on a paycheque costs a phone call.

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

interface BuiltDay {
  date: string
  rows: HoursRow[]
  unmatched: string[]
  costCodeOptions: CostCodeOption[]
  workSummary: string
  draft: unknown
  documentId: string | null
  rules: DayRules
}

export default function AgentWrapUpScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>()
  const router = useRouter()
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)

  const [job, setJob] = useState<{ number: string; name: string } | null>(null)
  const [call, setCall] = useState<CallState>(startCall())
  const [error, setError] = useState<string | null>(null)
  // Once the talking is done this holds the day and the review screens take
  // over, on the same screen — so nothing but leaving can lose the conversation.
  const [built, setBuilt] = useState<BuiltDay | null>(null)
  const [starting, setStarting] = useState(false)
  const [building, setBuilding] = useState(false)

  // Guards a real hazard: two overlapping turns would send the same answer
  // twice and let the agent skip a question.
  const busy = useRef(false)
  const scroller = useRef<ScrollView | null>(null)

  useEffect(() => {
    if (!jobId) return
    void (async () => {
      const { data: j } = await supabase
        .from('jobs')
        .select('job_number, job_name')
        .eq('id', jobId)
        .maybeSingle()
      if (j) {
        setJob({
          number: (j as { job_number: string }).job_number,
          name: (j as { job_name: string }).job_name,
        })
      }
    })()
  }, [jobId])

  // Never leave a phone talking in somebody's pocket.
  useEffect(
    () => () => {
      void Speech.stop()
    },
    [],
  )

  /** Say it, then start listening — no tap in between. */
  const speakThenListen = useCallback((text: string) => {
    void Speech.stop()
    Speech.speak(text, {
      rate: 0.95,
      pitch: 1.0,
      onDone: () => setCall((c) => afterSpeaking(c)),
      // If speech fails we must not strand him staring at a silent phone: move
      // to listening anyway, and the line is on screen for him to read.
      onError: () => setCall((c) => afterSpeaking(c)),
      onStopped: () => setCall((c) => afterSpeaking(c)),
    })
  }, [])

  async function beginRecording() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync()
      if (!perm.granted) {
        setError('Microphone access is off. Turn it on for FieldSynk in Settings.')
        return false
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
      return true
    } catch {
      setError("Couldn't start the microphone. Try again.")
      return false
    }
  }

  // The phone opens the mic by itself once the agent has finished its sentence.
  useEffect(() => {
    if (call.phase !== 'listening') return
    void beginRecording()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.phase, call.move?.say])

  useEffect(() => {
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 80)
    return () => clearTimeout(t)
  }, [call.log.length, call.log[call.log.length - 1]?.foreman])

  /** Open the call: the agent introduces itself, then asks the first question. */
  async function start() {
    if (!jobId || busy.current) return
    busy.current = true
    setStarting(true)
    setError(null)
    try {
      const reply = await sendTurn({ jobId, asked: null, answers: {}, followUps: {} })
      const next = afterTurn(call, reply)
      setCall(next)
      speakThenListen(
        reply.opening ? `${reply.opening} ${reply.move.say}` : reply.move.say,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the wrap-up.")
    } finally {
      setStarting(false)
      busy.current = false
    }
  }

  /** He has finished his answer. Send it and get the next thing to say. */
  async function finishedAnswering() {
    if (busy.current || call.phase !== 'listening') return
    busy.current = true
    setCall((c) => afterListening(c))
    setError(null)

    try {
      let audioBase64 = ''
      try {
        await recorder.stop()
        const uri = recorder.uri
        if (uri) {
          audioBase64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          })
        }
      } catch {
        // Nothing captured. Sent as silence so the agent asks again rather than
        // recording an answer he never gave.
        audioBase64 = ''
      }

      const reply = await sendTurn({
        jobId: jobId as string,
        asked: call.asked,
        answers: call.answers,
        followUps: call.followUps,
        audioBase64,
        mimeType: 'audio/m4a',
      })

      setCall((c) => {
        const next = afterTurn(c, reply)
        if (next.phase === 'speaking') speakThenListen(reply.move.say)
        else void Speech.speak(reply.move.say, { rate: 0.95 })
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that answer.")
      // Back to listening so he can say it again rather than losing the turn.
      setCall((c) => ({ ...c, phase: 'listening' }))
    } finally {
      busy.current = false
    }
  }

  /**
   * Everything is answered — build the draft and hand him the timesheet.
   *
   * The answers go through the SAME extract path the guided flow uses; nothing
   * here writes hours. Money stays human-in-the-loop.
   */
  async function buildDraft() {
    if (!jobId || busy.current) return
    busy.current = true
    setBuilding(true)
    setError(null)
    try {
      // Each answer goes across tied to the question it answered, so the
      // extractor never has to work out which half of a ramble was about
      // materials. Empty answers are dropped rather than sent as blanks — an
      // optional question he passed over is not an answer of "none".
      const answers = WRAPUP_QUESTIONS.map((q) => ({
        key: q.key,
        prompt: q.prompt,
        transcript: (call.answers[q.key] ?? '').trim(),
      })).filter((a) => a.transcript !== '')

      if (answers.length === 0) {
        setError('Nothing was recorded, so there is no day to build yet.')
        return
      }

      const res = await finishAgentWrapUp(jobId, answers)
      const date = res.sheetDate || todayIso()

      // Kept for the old guided flow, and as a safety net: if anything below
      // fails he can still open Log Today and find the day prefilled.
      putVoiceDraft(jobId, date, res.draft)

      if (!res.sheet) {
        throw new Error(
          "There's no crew assigned to this job, so there are no hours to check. Ask the office to add the crew.",
        )
      }

      setBuilt({
        date,
        rows: res.sheet.rows as HoursRow[],
        unmatched: res.sheet.unmatched ?? [],
        costCodeOptions: res.costCodeOptions ?? [],
        workSummary: res.draft?.workPerformed ?? '',
        draft: res.draft,
        documentId: res.documentId ?? null,
        rules: res.rules,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the day.")
    } finally {
      setBuilding(false)
      busy.current = false
    }
  }

  // The conversation is over — the review screens take it from here.
  if (built) {
    return (
      <Screen>
        <Text style={{ fontSize: fontSize.xxl, fontWeight: '700', color: colors.textPrimary }}>
          Daily wrap-up
        </Text>
        {job && (
          <Text style={{ fontSize: fontSize.md, color: colors.textMuted, marginTop: 2, marginBottom: spacing.md }}>
            {job.number} — {job.name}
          </Text>
        )}
        <WrapUpReview
          jobId={jobId as string}
          date={built.date}
          rows={built.rows}
          unmatched={built.unmatched}
          costCodeOptions={built.costCodeOptions}
          workSummary={built.workSummary}
          draft={built.draft}
          documentId={built.documentId}
          rules={built.rules}
        />
      </Screen>
    )
  }

  const phase = call.phase
  const notStarted = phase === 'idle'

  return (
    <Screen>
      <Text style={{ fontSize: fontSize.xxl, fontWeight: '700', color: colors.textPrimary }}>Daily wrap-up</Text>
      {job && (
        <Text style={{ fontSize: fontSize.md, color: colors.textMuted, marginTop: 2 }}>
          {job.number} — {job.name}
        </Text>
      )}

      <ScrollView
        ref={(r) => {
          scroller.current = r
        }}
        style={{ flex: 1, marginTop: spacing.lg }}
        contentContainerStyle={{ paddingBottom: spacing.lg }}
      >
        {notStarted && (
          <Text style={{ fontSize: fontSize.md, color: colors.textMuted }}>
            FieldSynk will ask you a few questions about today. Just talk normally
            — tap the button when you have finished each answer.
          </Text>
        )}

        {call.log.map((x, i) => (
          <View key={i} style={{ marginBottom: spacing.md }}>
            <Text style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary }}>
              {x.agent}
            </Text>
            {x.foreman ? (
              <Text
                style={{
                  fontSize: fontSize.md,
                  color: colors.textMuted,
                  marginTop: 4,
                  paddingLeft: spacing.md,
                }}
              >
                {x.foreman}
              </Text>
            ) : null}
          </View>
        ))}
      </ScrollView>

      {error && (
        <Text style={{ fontSize: fontSize.md, color: colors.error, marginBottom: spacing.sm }}>
          {error}
        </Text>
      )}

      {/* ── the one control ─────────────────────────────────────────────── */}
      {notStarted && (
        <Pressable
          onPress={start}
          disabled={starting}
          style={{
            backgroundColor: colors.primary,
            borderRadius: radius.md,
            paddingVertical: spacing.md,
            alignItems: 'center',
          }}
        >
          {starting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ fontSize: fontSize.md, color: '#fff', fontWeight: '700' }}>
              Start the wrap-up
            </Text>
          )}
        </Pressable>
      )}

      {/* The agent needs signal. He often has none — that is the job. So the
          way through without it is always on screen, not hidden behind a
          failure: record the answers now, and they go up when he has bars.
          A wrap-up he cannot file is a wrap-up he stops doing. */}
      {(notStarted || (error && notStarted)) && (
        <Pressable
          onPress={() => router.replace(`/wrapup/${jobId}`)}
          style={{ paddingVertical: spacing.md, alignItems: 'center' }}
        >
          <Text style={{ fontSize: fontSize.md, color: colors.primary, fontWeight: '600' }}>
            No signal? Record it instead
          </Text>
        </Pressable>
      )}

      {phase === 'speaking' && (
        <Text
          style={{ fontSize: fontSize.md, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md }}
        >
          FieldSynk is speaking…
        </Text>
      )}

      {phase === 'listening' && (
        <Pressable
          onPress={finishedAnswering}
          style={{
            backgroundColor: colors.error,
            borderRadius: radius.md,
            paddingVertical: spacing.lg,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: fontSize.md, color: '#fff', fontWeight: '700' }}>
            Listening — tap when you&apos;re done
          </Text>
        </Pressable>
      )}

      {phase === 'thinking' && (
        <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {(phase === 'done' || phase === 'handoff') && (
        <Pressable
          onPress={buildDraft}
          disabled={building}
          style={{
            backgroundColor: colors.primary,
            borderRadius: radius.md,
            paddingVertical: spacing.md,
            alignItems: 'center',
          }}
        >
          {building ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ fontSize: fontSize.md, color: '#fff', fontWeight: '700' }}>
              {phase === 'handoff' ? 'Finish on the screen' : "Check today's log"}
            </Text>
          )}
        </Pressable>
      )}
    </Screen>
  )
}
