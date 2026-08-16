import { supabase } from './supabase'

// Calls into the FieldSynk web API (the routes that need server-side keys, like
// voice transcription). Everything else in the app talks to Supabase directly.
// The web voice route accepts a Supabase Bearer token (resolveApiAuth on the web),
// so it runs as the signed-in user with the same row-level security.

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://fieldsynk.org'

export interface VoiceMaterial {
  name: string
  quantity: number | null
  unit: string | null
}
export interface VoiceAbsence {
  name: string
  reason: string
}
export interface VoiceDraft {
  workPerformed: string
  absences: VoiceAbsence[]
  materials: VoiceMaterial[]
  holdups: string
  safety: string
  crewNote: string
}
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
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Your session expired — sign in again.')

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
