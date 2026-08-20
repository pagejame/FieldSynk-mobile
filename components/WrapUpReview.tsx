import { useMemo, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
  Modal,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { colors, spacing, radius, fontSize } from '@/lib/theme'
import { recalcRow, type HoursRow, type DayRules } from '@/lib/hours-row'
import {
  REVIEW_STEPS,
  STEP_TITLE,
  checkStep,
  nextStep,
  prevStep,
  stepNumber,
  outstanding,
  type ReviewStep,
  type ReviewState,
} from '@/lib/review-flow'
import { uploadSafetyPage, fileTheDay } from '@/lib/api'

// What the foreman walks through once he has stopped talking.
//
//   hours and cost codes -> work performed -> safety photos -> check the day
//
// A phone, one hand, at the end of a twelve-hour day. So it is a CARD PER MAN
// rather than a table — a spreadsheet on a 6-inch screen is a spreadsheet
// nobody reads — and the button that moves him on is always the biggest thing
// at the bottom.
//
// The rules about what blocks and what merely warns are in review-flow.ts, which
// is the same file the web uses. This only shows them.

export interface CostCodeOption {
  id: string
  code: string
  description: string | null
}

export interface WrapUpReviewProps {
  jobId: string
  date: string
  rows: HoursRow[]
  unmatched: string[]
  costCodeOptions: CostCodeOption[]
  workSummary: string
  draft: unknown
  documentId: string | null
  rules: DayRules
}

interface SafetyPhoto {
  documentId: string
  page: number
  uri: string
}

const fmt = (n: number) => String(Math.round(n * 100) / 100)

export function WrapUpReview(props: WrapUpReviewProps) {
  const router = useRouter()

  const [step, setStep] = useState<ReviewStep>('hours')
  const [rows, setRows] = useState<HoursRow[]>(props.rows)
  const [unmatched, setUnmatched] = useState<string[]>(props.unmatched)
  const [summary, setSummary] = useState(props.workSummary)
  const [draft, setDraft] = useState<Record<string, unknown>>(
    (props.draft ?? {}) as Record<string, unknown>,
  )
  const [photos, setPhotos] = useState<SafetyPhoto[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Which row's cost code is being chosen. */
  const [picking, setPicking] = useState<string | null>(null)

  const state: ReviewState = useMemo(
    () => ({
      step,
      hoursConfirmed: true,
      missingCostCodes: rows.filter((r) => !r.costCodeId).length,
      unmatchedNames: unmatched,
      hasWorkSummary: summary.trim().length > 0,
      safetyPhotos: photos.length,
    }),
    [step, rows, unmatched, summary, photos],
  )

  const { blockers, warnings } = checkStep(step, state)
  const totals = rows.reduce(
    (a, r) => ({ st: a.st + r.st, ot: a.ot + r.ot, dt: a.dt + r.dt }),
    { st: 0, ot: 0, dt: 0 },
  )
  const codeById = useMemo(
    () => new Map(props.costCodeOptions.map((c) => [c.id, c])),
    [props.costCodeOptions],
  )

  function patchRow(employeeId: string, patch: Partial<HoursRow>) {
    setRows((rs) =>
      rs.map((r) =>
        r.employeeId === employeeId
          ? // Re-split through the same code the server used, so what he sees is
            // what gets filed.
            recalcRow({ ...r, ...patch }, props.rules, props.date)
          : r,
      ),
    )
  }

  /**
   * "Not one of my crew" — and it means it.
   *
   * An unmatched name becomes an ABSENCE ROW further down with no worker
   * attached. Clearing the warning without removing the line would leave a
   * phantom absence on the day.
   */
  function dismissName(name: string) {
    const norm = name.trim().toLowerCase()
    setUnmatched((u) => u.filter((x) => x !== name))
    setDraft((d) => ({
      ...d,
      crew: ((d.crew ?? []) as { name?: string }[]).filter(
        (c) => (c.name ?? '').trim().toLowerCase() !== norm,
      ),
      absences: ((d.absences ?? []) as { name?: string }[]).filter(
        (a) => (a.name ?? '').trim().toLowerCase() !== norm,
      ),
    }))
  }

  async function addPhotos() {
    setError(null)
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      setError('Camera access is off. Turn it on for FieldSynk in Settings.')
      return
    }

    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6, exif: false })
    if (shot.canceled || !shot.assets?.[0]?.uri) return

    setBusy(true)
    try {
      const uri = shot.assets[0].uri
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
      const r = await uploadSafetyPage({
        jobId: props.jobId,
        date: props.date,
        imageBase64: b64,
        mimeType: shot.assets[0].mimeType ?? 'image/jpeg',
        page: photos.length + 1,
      })
      setPhotos((p) => [...p, { documentId: r.documentId, page: r.page, uri }])
    } catch (e) {
      setError(e instanceof Error ? e.message : "That photo didn't upload.")
    } finally {
      setBusy(false)
    }
  }

  async function file() {
    setBusy(true)
    setError(null)
    try {
      const hours: Record<string, { st: number; ot: number; dt: number }> = {}
      const costCodes: Record<string, string> = {}
      for (const r of rows) {
        hours[r.employeeId] = { st: r.st, ot: r.ot, dt: r.dt }
        if (r.costCodeId) costCodes[r.employeeId] = r.costCodeId
      }

      await fileTheDay({
        jobId: props.jobId,
        date: props.date,
        draft: { ...draft, workPerformed: summary },
        documentId: props.documentId,
        hours,
        costCodes,
      })
      setStep('saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : "The day couldn't be filed.")
    } finally {
      setBusy(false)
    }
  }

  // ── filed ─────────────────────────────────────────────────────────────────

  if (step === 'saved') {
    return (
      <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
        <Feather name="check-circle" size={40} color={colors.success} />
        <Text
          style={{
            fontSize: fontSize.xl,
            fontWeight: '700',
            color: colors.textPrimary,
            marginTop: spacing.md,
          }}
        >
          The day is filed
        </Text>
        <Text
          style={{
            fontSize: fontSize.md,
            color: colors.textSecondary,
            marginTop: spacing.xs,
            textAlign: 'center',
          }}
        >
          Hours, work performed{photos.length > 0 ? ', safety documents' : ''} and the
          recording are all on the job.
        </Text>
        <Pressable
          onPress={() => router.replace('/')}
          style={{
            marginTop: spacing.lg,
            backgroundColor: colors.primary,
            borderRadius: radius.md,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.lg,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: fontSize.md }}>
            Back to my jobs
          </Text>
        </Pressable>
      </View>
    )
  }

  const nextLabel = step === 'safety' ? 'Finished' : step === 'review' ? 'File the day' : 'Next'

  return (
    <View style={{ flex: 1 }}>
      {/* ── where he is ─────────────────────────────────────────────────── */}
      <View style={{ paddingBottom: spacing.sm }}>
        <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary }}>
          {STEP_TITLE[step]}
        </Text>
        <View style={{ flexDirection: 'row', gap: 4, marginTop: spacing.xs }}>
          {REVIEW_STEPS.map((s, i) => (
            <View
              key={s}
              style={{
                height: 4,
                flex: 1,
                borderRadius: 2,
                backgroundColor: i < stepNumber(step) ? colors.primary : colors.border,
              }}
            />
          ))}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }}>
        {blockers.map((b, i) => (
          <Banner key={`b${i}`} tone="error" text={b} />
        ))}
        {warnings.map((w, i) => (
          <Banner key={`w${i}`} tone="warning" text={w} />
        ))}
        {error ? <Banner tone="error" text={error} /> : null}

        {/* ── 1. hours and cost codes ───────────────────────────────────── */}
        {step === 'hours' && (
          <View>
            <Text
              style={{
                fontSize: fontSize.sm,
                color: colors.textSecondary,
                marginBottom: spacing.sm,
              }}
            >
              Everyone is on a full day unless the agent heard otherwise. Set each
              man&apos;s cost code — that part isn&apos;t guessed.
            </Text>

            {rows.map((r) => {
              const code = r.costCodeId ? codeById.get(r.costCodeId) : null
              return (
                <View
                  key={r.employeeId}
                  style={{
                    borderWidth: 1,
                    borderColor: r.assumedEnd ? colors.warning : colors.border,
                    backgroundColor: colors.surface,
                    borderRadius: radius.md,
                    padding: spacing.md,
                    marginBottom: spacing.sm,
                  }}
                >
                  <Text
                    style={{
                      fontSize: fontSize.lg,
                      fontWeight: '600',
                      color: colors.textPrimary,
                    }}
                  >
                    {r.name}
                  </Text>
                  {r.reason ? (
                    <Text style={{ fontSize: fontSize.sm, color: colors.textMuted }}>
                      {r.reason}
                    </Text>
                  ) : null}

                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                      marginTop: spacing.sm,
                    }}
                  >
                    <Text style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>
                      Missed
                    </Text>
                    <TextInput
                      value={String(r.hoursMissed)}
                      onChangeText={(t) =>
                        patchRow(r.employeeId, { hoursMissed: Number(t) || 0 })
                      }
                      keyboardType="decimal-pad"
                      style={{
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: radius.sm,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 6,
                        minWidth: 64,
                        fontSize: fontSize.md,
                        color: colors.textPrimary,
                      }}
                    />
                    <Text style={{ fontSize: fontSize.sm, color: colors.textMuted }}>
                      of {r.scheduledHours}
                    </Text>
                  </View>

                  {/* Which end of the day — it decides his overtime. */}
                  {r.hoursMissed > 0 ? (
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                      {(
                        [
                          ['start', 'Came in late'],
                          ['end', 'Left early'],
                        ] as const
                      ).map(([value, label]) => {
                        const on = r.missedFrom === value
                        return (
                          <Pressable
                            key={value}
                            onPress={() => patchRow(r.employeeId, { missedFrom: value })}
                            style={{
                              flex: 1,
                              borderWidth: 1,
                              borderColor: on ? colors.primary : colors.border,
                              backgroundColor: on ? colors.primarySoft : 'transparent',
                              borderRadius: radius.sm,
                              paddingVertical: spacing.sm,
                              alignItems: 'center',
                            }}
                          >
                            <Text
                              style={{
                                fontSize: fontSize.sm,
                                fontWeight: on ? '700' : '400',
                                color: on ? colors.primary : colors.textSecondary,
                              }}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  ) : null}

                  {r.assumedEnd ? (
                    <Text
                      style={{
                        fontSize: fontSize.sm,
                        color: colors.warning,
                        marginTop: spacing.xs,
                      }}
                    >
                      Say which — it changes his overtime.
                    </Text>
                  ) : null}

                  <Text
                    style={{
                      fontSize: fontSize.md,
                      color: colors.textPrimary,
                      marginTop: spacing.sm,
                    }}
                  >
                    {fmt(r.st)} ST · {fmt(r.ot)} OT · {fmt(r.dt)} DT
                  </Text>

                  <Pressable
                    onPress={() => setPicking(r.employeeId)}
                    style={{
                      marginTop: spacing.sm,
                      borderWidth: 1,
                      borderColor: r.costCodeId ? colors.border : colors.warning,
                      borderRadius: radius.sm,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.sm,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: fontSize.md,
                        color: code ? colors.textPrimary : colors.textMuted,
                      }}
                    >
                      {code ? `${code.code}${code.description ? ` — ${code.description}` : ''}` : 'Set a cost code'}
                    </Text>
                  </Pressable>
                </View>
              )
            })}

            <Text
              style={{
                fontSize: fontSize.md,
                fontWeight: '700',
                color: colors.textPrimary,
                marginTop: spacing.sm,
              }}
            >
              Total {fmt(totals.st)} ST · {fmt(totals.ot)} OT · {fmt(totals.dt)} DT
            </Text>

            {unmatched.length > 0 && (
              <View style={{ marginTop: spacing.md }}>
                <Text
                  style={{ fontSize: fontSize.sm, fontWeight: '700', color: colors.error }}
                >
                  Names it couldn&apos;t place
                </Text>
                {unmatched.map((n) => (
                  <View
                    key={n}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                      marginTop: spacing.xs,
                    }}
                  >
                    <Text style={{ fontSize: fontSize.md, color: colors.textPrimary, flex: 1 }}>
                      {n}
                    </Text>
                    <Pressable onPress={() => dismissName(n)}>
                      <Text style={{ fontSize: fontSize.sm, color: colors.textMuted }}>
                        not my crew
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── 2. work performed ─────────────────────────────────────────── */}
        {step === 'summary' && (
          <View>
            <Text
              style={{
                fontSize: fontSize.sm,
                color: colors.textSecondary,
                marginBottom: spacing.sm,
              }}
            >
              Written up from what you said. This is what the customer reads.
            </Text>
            <TextInput
              value={summary}
              onChangeText={setSummary}
              multiline
              textAlignVertical="top"
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                borderRadius: radius.md,
                padding: spacing.md,
                minHeight: 200,
                fontSize: fontSize.md,
                color: colors.textPrimary,
              }}
            />
          </View>
        )}

        {/* ── 3. safety documents ───────────────────────────────────────── */}
        {step === 'safety' && (
          <View>
            <Text
              style={{
                fontSize: fontSize.sm,
                color: colors.textSecondary,
                marginBottom: spacing.md,
              }}
            >
              Photograph today&apos;s safety paperwork — front and back, as many pages as
              there are. FieldSynk stores your forms; it doesn&apos;t replace them.
            </Text>

            <Pressable
              onPress={addPhotos}
              disabled={busy}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.sm,
                borderWidth: 1,
                borderColor: colors.primary,
                borderRadius: radius.md,
                paddingVertical: spacing.md,
              }}
            >
              {busy ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Feather name="camera" size={18} color={colors.primary} />
              )}
              <Text style={{ color: colors.primary, fontWeight: '700', fontSize: fontSize.md }}>
                Add a page
              </Text>
            </Pressable>

            <View
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}
            >
              {photos.map((p) => (
                <View key={p.documentId}>
                  <Image
                    source={{ uri: p.uri }}
                    style={{
                      width: 96,
                      height: 128,
                      borderRadius: radius.sm,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  />
                  <Text style={{ fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 }}>
                    Page {p.page}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── 4. check the day ──────────────────────────────────────────── */}
        {step === 'review' && (
          <View style={{ gap: spacing.md }}>
            <Row label="Hours">
              {rows.length} worker{rows.length === 1 ? '' : 's'} · {fmt(totals.st)} ST ·{' '}
              {fmt(totals.ot)} OT · {fmt(totals.dt)} DT
            </Row>
            <Row label="Work performed">{summary.trim() || 'Nothing written.'}</Row>
            <Row label="Safety">
              {photos.length === 0
                ? 'No documents attached.'
                : `${photos.length} page${photos.length === 1 ? '' : 's'} attached.`}
            </Row>

            {outstanding(state).length > 0 && (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.warning,
                  backgroundColor: colors.warningSoft,
                  borderRadius: radius.md,
                  padding: spacing.md,
                }}
              >
                <Text
                  style={{ fontSize: fontSize.sm, fontWeight: '700', color: colors.warning }}
                >
                  Before you file it
                </Text>
                {outstanding(state).map((x, i) => (
                  <Text
                    key={i}
                    style={{
                      fontSize: fontSize.md,
                      color: colors.textPrimary,
                      marginTop: spacing.xs,
                    }}
                  >
                    • {x}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── moving between screens ──────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.sm }}>
        {step !== 'hours' && (
          <Pressable
            onPress={() => setStep(prevStep(step))}
            disabled={busy}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.lg,
            }}
          >
            <Text style={{ fontSize: fontSize.md, color: colors.textSecondary }}>Back</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => (step === 'review' ? void file() : setStep(nextStep(step)))}
          disabled={busy || blockers.length > 0}
          style={{
            flex: 1,
            backgroundColor: blockers.length > 0 ? colors.borderStrong : colors.primary,
            borderRadius: radius.md,
            paddingVertical: spacing.md,
            alignItems: 'center',
          }}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: fontSize.md }}>
              {nextLabel}
            </Text>
          )}
        </Pressable>
      </View>

      {/* ── choosing a cost code ────────────────────────────────────────── */}
      <Modal visible={picking !== null} animationType="slide" transparent>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <View
            style={{
              backgroundColor: colors.bg,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              padding: spacing.md,
              maxHeight: '70%',
            }}
          >
            <Text
              style={{ fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary }}
            >
              Cost code
            </Text>
            <ScrollView style={{ marginTop: spacing.sm }}>
              {props.costCodeOptions.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    setRows((rs) =>
                      rs.map((x) => (x.employeeId === picking ? { ...x, costCodeId: c.id } : x)),
                    )
                    setPicking(null)
                  }}
                  style={{
                    paddingVertical: spacing.md,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <Text style={{ fontSize: fontSize.md, color: colors.textPrimary }}>
                    {c.code}
                    {c.description ? ` — ${c.description}` : ''}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              onPress={() => setPicking(null)}
              style={{ paddingVertical: spacing.md, alignItems: 'center' }}
            >
              <Text style={{ fontSize: fontSize.md, color: colors.textSecondary }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function Banner({ tone, text }: { tone: 'error' | 'warning'; text: string }) {
  const isError = tone === 'error'
  return (
    <View
      style={{
        backgroundColor: isError ? colors.errorSoft : colors.warningSoft,
        borderRadius: radius.sm,
        padding: spacing.sm,
        marginBottom: spacing.sm,
      }}
    >
      <Text style={{ fontSize: fontSize.md, color: isError ? colors.error : colors.warning }}>
        {text}
      </Text>
    </View>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text
        style={{
          fontSize: fontSize.xs,
          fontWeight: '700',
          color: colors.textMuted,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      <Text style={{ fontSize: fontSize.md, color: colors.textPrimary, marginTop: 2 }}>
        {children}
      </Text>
    </View>
  )
}
