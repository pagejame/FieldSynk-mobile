// The foreman's side of the spoken wrap-up.
//
// The server decides WHAT the agent says (see conversation.ts in the web repo).
// This decides what the phone is doing while it says it: talking, listening,
// thinking, or finished. Pure — no audio, no speech, no React, so the awkward
// parts can be tested without a handset.
//
// He is holding a phone with gloves on, or it is in his pocket. So the phone
// starts listening BY ITSELF the moment the agent stops talking. He taps once
// when he has finished his answer, and never has to read anything on screen.
// Every extra tap is a tap in the rain.

export type Phase =
  /** Nothing started yet. */
  | 'idle'
  /** The agent is talking. The mic is off — never record the phone talking. */
  | 'speaking'
  /** Listening to him. */
  | 'listening'
  /** Uploading and waiting for the next thing to say. */
  | 'thinking'
  /** All done — the draft is ready to review. */
  | 'done'
  /** It could not hear him on a required question. Finish on screen. */
  | 'handoff'

export interface Move {
  kind: 'ask' | 'follow_up' | 'repeat' | 'handoff' | 'done'
  questionKey?: string
  say: string
}

export interface Exchange {
  agent: string
  foreman: string | null
}

export interface CallState {
  phase: Phase
  /** What the agent last said, and is waiting on. */
  move: Move | null
  /** The question his next recording answers. Null when nothing is pending. */
  asked: string | null
  answers: Record<string, string>
  followUps: Record<string, number>
  /** The conversation so far, oldest first — shown on screen so he can see it
   *  heard him correctly. A wrong name spotted here costs nothing to fix; the
   *  same wrong name spotted on a paycheque costs a phone call. */
  log: Exchange[]
}

export function startCall(): CallState {
  return { phase: 'idle', move: null, asked: null, answers: {}, followUps: {}, log: [] }
}

/** What the phone should be doing given what the agent just said. */
export function phaseFor(move: Move): Phase {
  if (move.kind === 'done') return 'done'
  if (move.kind === 'handoff') return 'handoff'
  return 'speaking'
}

/** True while the call is still going — used to decide whether to auto-listen. */
export const isLive = (p: Phase): boolean =>
  p === 'speaking' || p === 'listening' || p === 'thinking'

/**
 * Fold the server's reply into the call.
 *
 * `heard` is what it transcribed from his last answer, so the on-screen log can
 * show it. A repeat or a follow-up does NOT add a new blank exchange — it is
 * still the same question, and stacking them would make a two-line conversation
 * look like six.
 */
export function afterTurn(
  state: CallState,
  reply: {
    move: Move
    answers?: Record<string, string>
    followUps?: Record<string, number>
    heard?: string | null
  },
): CallState {
  const log = [...state.log]

  // Attach what he said to the exchange still waiting on him.
  if (state.move && log.length > 0 && log[log.length - 1].foreman === null) {
    const said = (reply.heard ?? '').trim()
    log[log.length - 1] = { ...log[log.length - 1], foreman: said === '' ? null : said }
  }

  // A repeat means it did not hear him. Replace the unanswered line rather than
  // adding another — otherwise "say that again" three times reads as three
  // separate questions he failed to answer.
  if (reply.move.kind === 'repeat' && log.length > 0 && log[log.length - 1].foreman === null) {
    log[log.length - 1] = { agent: reply.move.say, foreman: null }
  } else {
    log.push({ agent: reply.move.say, foreman: null })
  }

  return {
    phase: phaseFor(reply.move),
    move: reply.move,
    asked: reply.move.questionKey ?? null,
    answers: reply.answers ?? state.answers,
    followUps: reply.followUps ?? state.followUps,
    log,
  }
}

/** The agent has finished speaking. If the call is still live, start listening. */
export function afterSpeaking(state: CallState): CallState {
  if (state.phase !== 'speaking') return state
  return { ...state, phase: 'listening' }
}

/** He tapped to say he has finished answering. */
export function afterListening(state: CallState): CallState {
  if (state.phase !== 'listening') return state
  return { ...state, phase: 'thinking' }
}

/** How far through the seven he is, for the progress line. */
export function progress(
  state: CallState,
  totalQuestions: number,
): { answered: number; total: number } {
  const answered = Object.values(state.answers).filter((a) => a !== undefined).length
  return { answered: Math.min(answered, totalQuestions), total: totalQuestions }
}
