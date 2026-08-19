import type { WrapUpQuestion } from './wrapup'

// The guided wrap-up, as a state machine.
//
// The app asks one question out loud, records the answer, and moves on. Compared
// with one long recording this is better in two ways that matter on a site: he
// cannot reach the end having forgotten safety, and every answer arrives attached
// to a KNOWN question — so the extractor never has to work out which half of a
// ramble was about materials.
//
// Pure: no audio, no speech, no React. The screen drives it.

export interface Answer {
  key: string
  /** Local file uri of the recording for this question. */
  uri: string
  seconds: number
}

export interface FlowState {
  questions: WrapUpQuestion[]
  index: number
  answers: Answer[]
}

/** Which questions cannot be left unanswered. Mirrors the canonical list. */
const REQUIRED = new Set(['crew', 'work', 'safety_forms', 'safety_incident'])

/** The caller supplies the questions, so this file stays pure data-in/data-out
 *  and does not care where the list came from. */
export function startFlow(questions: WrapUpQuestion[]): FlowState {
  return { questions, index: 0, answers: [] }
}

export const currentQuestion = (s: FlowState): WrapUpQuestion | null =>
  s.questions[s.index] ?? null

export const isRequired = (q: WrapUpQuestion): boolean => REQUIRED.has(q.key)

export const answerFor = (s: FlowState, key: string): Answer | null =>
  s.answers.find((a) => a.key === key) ?? null

/**
 * Record (or re-record) the answer to the question he is on.
 *
 * Re-answering REPLACES rather than appends — a foreman who says it again
 * because the first go was wrong must not end up sending both versions, with
 * the extractor free to believe either.
 */
export function withAnswer(s: FlowState, uri: string, seconds: number): FlowState {
  const q = currentQuestion(s)
  if (!q) return s
  const rest = s.answers.filter((a) => a.key !== q.key)
  return { ...s, answers: [...rest, { key: q.key, uri, seconds }] }
}

/** Drop the answer to the current question, so he can start it again. */
export function withoutCurrentAnswer(s: FlowState): FlowState {
  const q = currentQuestion(s)
  if (!q) return s
  return { ...s, answers: s.answers.filter((a) => a.key !== q.key) }
}

export const canGoNext = (s: FlowState): boolean => {
  const q = currentQuestion(s)
  if (!q) return false
  // A required question needs an answer before he can move on. An optional one
  // can be passed over — "anything hold you up?" on a clean day is silence, and
  // making him say "no" to move on is the kind of friction that kills adoption.
  return !isRequired(q) || answerFor(s, q.key) !== null
}

export const next = (s: FlowState): FlowState =>
  canGoNext(s) ? { ...s, index: Math.min(s.index + 1, s.questions.length) } : s

export const back = (s: FlowState): FlowState => ({
  ...s,
  index: Math.max(0, s.index - 1),
})

export const isFinished = (s: FlowState): boolean => s.index >= s.questions.length

/** Required questions still unanswered — what stops him sending. */
export function missingRequired(s: FlowState): WrapUpQuestion[] {
  return s.questions.filter((q) => isRequired(q) && answerFor(s, q.key) === null)
}

export const canSubmit = (s: FlowState): boolean => missingRequired(s).length === 0

/** Progress for the bar at the top: answered vs asked. */
export function progress(s: FlowState): { answered: number; total: number } {
  return { answered: s.answers.length, total: s.questions.length }
}
