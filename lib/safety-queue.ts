import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import { supabase } from './supabase'
import { uploadJobDocument } from './upload-doc'

// Offline queue for the daily SAFETY step — kept completely separate from the
// report/payroll offline queue on purpose (safety never rides the payroll path).
// Two kinds of work survive no-signal + app restarts:
//   1. the safety answers (forms done? incident?) → upsert safety_daily
//   2. photographed safety forms → uploaded as job documents
// Photos are copied into the app's persistent directory so they outlive the OS
// clearing the camera cache, and are deleted once uploaded.

const ANSWER_KEY = 'fieldsynk:offline_safety_v1'
const PHOTO_KEY = 'fieldsynk:offline_safety_photos_v1'
const PHOTO_DIR = `${FileSystem.documentDirectory}safety-queue/`

export interface QueuedSafetyAnswer {
  key: string // `${jobId}:${date}` — re-answering the same day replaces it
  queuedAt: string
  jobId: string
  date: string
  formsCompleted: boolean
  missingReason: string | null
  incident: boolean
  incidentNotes: string | null
}

export interface QueuedSafetyPhoto {
  id: string
  queuedAt: string
  companyId: string
  jobId: string
  localPath: string // a persistent copy inside PHOTO_DIR
  fileName: string
  mimeType: string
}

// ── answers ──────────────────────────────────────────────────────────────────

async function readAnswers(): Promise<QueuedSafetyAnswer[]> {
  try {
    const raw = await AsyncStorage.getItem(ANSWER_KEY)
    return raw ? (JSON.parse(raw) as QueuedSafetyAnswer[]) : []
  } catch {
    return []
  }
}
async function writeAnswers(items: QueuedSafetyAnswer[]): Promise<void> {
  await AsyncStorage.setItem(ANSWER_KEY, JSON.stringify(items))
}

export async function enqueueSafetyAnswer(
  a: Omit<QueuedSafetyAnswer, 'key' | 'queuedAt'>,
): Promise<void> {
  const key = `${a.jobId}:${a.date}`
  const queue = (await readAnswers()).filter((q) => q.key !== key)
  queue.push({ key, queuedAt: new Date().toISOString(), ...a })
  await writeAnswers(queue)
}

// ── photos ───────────────────────────────────────────────────────────────────

async function readPhotos(): Promise<QueuedSafetyPhoto[]> {
  try {
    const raw = await AsyncStorage.getItem(PHOTO_KEY)
    return raw ? (JSON.parse(raw) as QueuedSafetyPhoto[]) : []
  } catch {
    return []
  }
}
async function writePhotos(items: QueuedSafetyPhoto[]): Promise<void> {
  await AsyncStorage.setItem(PHOTO_KEY, JSON.stringify(items))
}

export async function enqueueSafetyPhoto(p: {
  companyId: string
  jobId: string
  uri: string
  fileName: string
  mimeType: string
}): Promise<void> {
  const dir = await FileSystem.getInfoAsync(PHOTO_DIR)
  if (!dir.exists) await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true })
  const id = `${Date.now()}-${Math.round(Math.random() * 1e6)}`
  const localPath = `${PHOTO_DIR}${id}-${p.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  await FileSystem.copyAsync({ from: p.uri, to: localPath })
  const queue = await readPhotos()
  queue.push({
    id,
    queuedAt: new Date().toISOString(),
    companyId: p.companyId,
    jobId: p.jobId,
    localPath,
    fileName: p.fileName,
    mimeType: p.mimeType,
  })
  await writePhotos(queue)
}

// ── counts + flush ─────────────────────────────────────────────────────────────

export async function getSafetyQueueCount(): Promise<number> {
  return (await readAnswers()).length + (await readPhotos()).length
}

/** Replay queued safety answers + photos. Anything that still fails stays queued. */
export async function flushSafetyQueue(): Promise<{ flushed: number; remaining: number }> {
  let flushed = 0

  // Answers → idempotent upsert (safe to replay).
  const answers = await readAnswers()
  const answersLeft: QueuedSafetyAnswer[] = []
  for (const a of answers) {
    try {
      const { error } = await supabase.from('safety_daily').upsert(
        {
          job_id: a.jobId,
          date: a.date,
          forms_completed: a.formsCompleted,
          missing_reason: a.formsCompleted ? null : a.missingReason,
          incident: a.incident,
          incident_notes: a.incident ? a.incidentNotes : null,
        },
        { onConflict: 'job_id,date' },
      )
      if (error) answersLeft.push(a)
      else flushed++
    } catch {
      answersLeft.push(a)
    }
  }
  if (answersLeft.length !== answers.length) await writeAnswers(answersLeft)

  // Photos → upload, then delete the local copy.
  const photos = await readPhotos()
  const photosLeft: QueuedSafetyPhoto[] = []
  for (const p of photos) {
    try {
      await uploadJobDocument({
        companyId: p.companyId,
        jobId: p.jobId,
        userId: null,
        uri: p.localPath,
        fileName: p.fileName,
        mimeType: p.mimeType,
        docType: 'safety_doc',
      })
      flushed++
      await FileSystem.deleteAsync(p.localPath, { idempotent: true })
    } catch {
      photosLeft.push(p)
    }
  }
  if (photosLeft.length !== photos.length) await writePhotos(photosLeft)

  return { flushed, remaining: answersLeft.length + photosLeft.length }
}
