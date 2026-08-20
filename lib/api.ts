import { supabase } from './supabase'

// Calls into the FieldSynk web API (the routes that need server-side keys, like
// voice transcription). Everything else in the app talks to Supabase directly.
// The web voice route accepts a Supabase Bearer token (resolveApiAuth on the web),
// so it runs as the signed-in user with the same row-level security.

// MUST include www. The apex domain 308-redirects to www, and a redirect to a
// DIFFERENT ORIGIN strips the Authorization header — deliberately, so credentials
// cannot leak to another host. The request still arrived, just with no token, and
// the server correctly refused it. Every "please sign in" on the phone was this.
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://www.fieldsynk.org'

// The draft shape lives in voice-apply, which is what actually consumes it — one
// definition, so the wire format and the thing that fills the timesheet cannot
// drift apart. (They already had: the app's copy was missing crew hours entirely,
// which type-checked fine while quietly dropping every hour the foreman spoke.)
export type { VoiceDraft, VoiceCrewLine, VoiceCrewDefault } from './voice-apply'
import type { VoiceDraft } from './voice-apply'

export interface VoiceResult {
  transcript: string
  draft: VoiceDraft
  transcribed: boolean
  extracted: boolean
}

/** Send a recording to the web voice route and get back the transcript + draft. */
export async function transcribeVoice(
  jobId: string,
  audioBase64: string,
  mimeType: string,
): Promise<VoiceResult> {
  // getSession() hands back whatever is stored, which on a phone that has been
  // in a basement all day can be an ACCESS TOKEN THAT HAS ALREADY EXPIRED — the
  // server then rejects it and the foreman is told to sign in when he is signed
  // in perfectly well. Ask for the user first: that forces a refresh if one is
  // due, so the token below is one the server will actually accept.
  const { error: refreshErr } = await supabase.auth.getUser()
  if (refreshErr) {
    const { error: retryErr } = await supabase.auth.refreshSession()
    if (retryErr) {
      // The refresh token is gone server-side — Supabase revokes the whole chain
      // when a rotated token is presented twice. Nothing can revive this session,
      // so end it properly: signOut clears the dead token and the root layout
      // sends him to the login screen. Leaving him on this page poking a mic and
      // being told to "sign in" while he appears signed in is the worst outcome.
      await supabase.auth.signOut()
      throw new Error('Your sign-in ended. Please sign in again.')
    }
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Your sign-in expired — sign out and back in.')

  const res = await fetch(`${API_BASE}/api/field-agents/voice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jobId, audioBase64, mimeType }),
  })

  let data: (VoiceResult & { error?: string }) | null = null
  try {
    data = (await res.json()) as VoiceResult & { error?: string }
  } catch {
    throw new Error('The voice service returned an unexpected response.')
  }
  if (!res.ok || !data) {
    throw new Error(data?.error ?? 'Could not process the recording.')
  }
  return data
}

/** Send a GUIDED wrap-up: one clip per question, each tied to its prompt. */
export async function sendWrapUp(
  jobId: string,
  answers: { key: string; prompt: string; audioBase64: string }[],
  mimeType: string,
): Promise<VoiceResult> {
  const { error: refreshErr } = await supabase.auth.getUser()
  if (refreshErr) {
    const { error: retryErr } = await supabase.auth.refreshSession()
    if (retryErr) {
      await supabase.auth.signOut()
      throw new Error('Your sign-in ended. Please sign in again.')
    }
  }
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Your sign-in ended. Please sign in again.')

  const res = await fetch(`${API_BASE}/api/field-agents/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId, answers, mimeType }),
  })

  let data: (VoiceResult & { error?: string }) | null = null
  try {
    data = (await res.json()) as VoiceResult & { error?: string }
  } catch {
    throw new Error('The voice service returned an unexpected response.')
  }
  if (!res.ok || !data) throw new Error(data?.error ?? 'Could not process the wrap-up.')
  return data
}

// ── The spoken wrap-up, one turn at a time ─────────────────────────────────

/**
 * A token the server will actually accept.
 *
 * getSession() hands back whatever is stored, which on a phone that has been in
 * a basement all day can be an access token that has ALREADY EXPIRED — the
 * server then rejects it and the foreman is told to sign in when he is signed in
 * perfectly well. getUser() forces a refresh if one is due.
 *
 * Extracted on the third copy of it. Three transcriptions of the same subtle
 * sequence is three chances for one of them to quietly lose the refresh.
 */
async function bearerToken(): Promise<string> {
  const { error: refreshErr } = await supabase.auth.getUser()
  if (refreshErr) {
    const { error: retryErr } = await supabase.auth.refreshSession()
    if (retryErr) {
      // The refresh token is gone server-side — Supabase revokes the whole chain
      // when a rotated token is presented twice. Nothing can revive this session.
      await supabase.auth.signOut()
      throw new Error('Your sign-in ended. Please sign in again.')
    }
  }
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Your sign-in ended. Please sign in again.')
  return token
}

export interface AgentMove {
  kind: 'ask' | 'follow_up' | 'repeat' | 'handoff' | 'done'
  questionKey?: string
  say: string
}

export interface TurnReply {
  /** Said once at the very start, before the first question. */
  opening?: string
  move: AgentMove
  answers: Record<string, string>
  followUps: Record<string, number>
  heard: string | null
  /** True when the recording arrived but could not be transcribed — so the app
   *  can say "I couldn't hear you" rather than implying he said nothing. */
  transcriptionFailed?: boolean
}

/**
 * One exchange with the agent: send what he just said, get back the next thing
 * to say out loud.
 *
 * The QUESTION LIST is rebuilt on the server every turn — this only sends his
 * answers. An old build of this app therefore cannot drop the safety questions.
 */
export async function sendTurn(args: {
  jobId: string
  asked: string | null
  answers: Record<string, string>
  followUps: Record<string, number>
  audioBase64?: string
  mimeType?: string
}): Promise<TurnReply> {
  const token = await bearerToken()

  const res = await fetch(`${API_BASE}/api/field-agents/voice/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  })

  let data: (TurnReply & { error?: string }) | null = null
  try {
    data = (await res.json()) as TurnReply & { error?: string }
  } catch {
    throw new Error('The voice service returned an unexpected response.')
  }
  if (!res.ok || !data?.move) {
    throw new Error(data?.error ?? "Couldn't reach the wrap-up agent.")
  }
  return data
}

/**
 * Build the day from a spoken-agent conversation.
 *
 * Sends the TRANSCRIPTS the turn loop already produced, not audio: re-sending
 * the clips would pay for a second transcription and could come back with
 * different words — and then the draft would not match the conversation he just
 * watched on screen. Same endpoint and same extractor as the guided flow, so
 * there is one path from answers to a draft, not two.
 */
export interface WrapUpResult extends VoiceResult {
  sheet: { rows: unknown[]; unmatched: string[] } | null
  sheetDate: string
  costCodeOptions: { id: string; code: string; description: string | null }[]
  rules: {
    otDailyThreshold: number
    saturdayRule: 'straight' | 'ot' | 'dt'
    sundayRule: 'ot' | 'dt'
    holidayRule: 'straight' | 'ot' | 'dt' | 'unpaid'
  }
  documentId: string | null
}

export async function finishAgentWrapUp(
  jobId: string,
  answers: { key: string; prompt: string; transcript: string }[],
): Promise<WrapUpResult> {
  const token = await bearerToken()

  const res = await fetch(`${API_BASE}/api/field-agents/voice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId, answers, mimeType: 'audio/m4a' }),
  })

  let data: (WrapUpResult & { error?: string }) | null = null
  try {
    data = (await res.json()) as WrapUpResult & { error?: string }
  } catch {
    throw new Error('The voice service returned an unexpected response.')
  }
  if (!res.ok || !data) throw new Error(data?.error ?? "Couldn't build the day.")
  return data
}

// ── the review flow ────────────────────────────────────────────────────────

/**
 * One page of the day's safety paperwork.
 *
 * Goes through the web route rather than straight to Storage like
 * uploadJobDocument does, because that route also records that the forms were
 * DONE — and the whole reason the spoken safety question was dropped is that a
 * photograph is the record and a spoken "yes" is not. One path, one behaviour on
 * both the phone and the browser.
 */
export async function uploadSafetyPage(args: {
  jobId: string
  date: string
  imageBase64: string
  mimeType: string
  page: number
}): Promise<{ documentId: string; page: number }> {
  const token = await bearerToken()

  const res = await fetch(`${API_BASE}/api/field-agents/voice/safety-photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  })

  const data = (await res.json().catch(() => null)) as
    | { documentId: string; page: number; error?: string }
    | null
  if (!res.ok || !data?.documentId) {
    throw new Error(data?.error ?? "That photo didn't upload.")
  }
  return { documentId: data.documentId, page: data.page ?? args.page }
}

/**
 * File the day.
 *
 * The hours are sent EXPLICITLY, per man, because he has just looked at the
 * split and said it is right. Letting the server recompute would overrule a
 * person who was standing on the job — and it is the only way the union
 * short-day rule survives, since whether a man was late or left early cannot be
 * recovered from a total.
 */
export async function fileTheDay(args: {
  jobId: string
  date: string
  draft: unknown
  documentId: string | null
  hours: Record<string, { st: number; ot: number; dt: number }>
  costCodes: Record<string, string>
}): Promise<void> {
  const token = await bearerToken()

  const res = await fetch(`${API_BASE}/api/field-agents/voice/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  })

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error ?? "The day couldn't be filed.")
  }
}
