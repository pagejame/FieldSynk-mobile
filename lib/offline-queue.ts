import AsyncStorage from '@react-native-async-storage/async-storage'
import { applyReport, type DayReportPayload } from './apply-report'

// Offline queue for daily reports. If a save can't reach the server (basement, no
// signal), the report is stored on the device and replayed when signal returns.
// Keyed by job+date so re-editing the same day REPLACES its pending entry instead
// of stacking duplicates. Replay is safe because applyReport is idempotent.

const QUEUE_KEY = 'fieldsynk:offline_reports_v1'

export interface QueuedReport {
  key: string // `${jobId}:${date}`
  queuedAt: string
  payload: DayReportPayload
}

async function readQueue(): Promise<QueuedReport[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as QueuedReport[]) : []
  } catch {
    return []
  }
}

async function writeQueue(items: QueuedReport[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items))
}

export async function enqueueReport(payload: DayReportPayload): Promise<void> {
  const key = `${payload.jobId}:${payload.date}`
  const queue = await readQueue()
  const withoutThis = queue.filter((q) => q.key !== key)
  withoutThis.push({ key, queuedAt: new Date().toISOString(), payload })
  await writeQueue(withoutThis)
}

/** Dates for one job still sitting on the phone, so the history screen can say
 *  "waiting to send" rather than claiming the day is in when it is not. */
export async function getQueuedDatesForJob(jobId: string): Promise<string[]> {
  const queue = await readQueue()
  return queue.filter((q) => q.payload.jobId === jobId).map((q) => q.payload.date)
}

export async function getQueueCount(): Promise<number> {
  return (await readQueue()).length
}

/** Replay every queued report. Anything that still fails stays queued. */
export async function flushQueue(): Promise<{ flushed: number; remaining: number }> {
  const queue = await readQueue()
  if (queue.length === 0) return { flushed: 0, remaining: 0 }
  const stillQueued: QueuedReport[] = []
  let flushed = 0
  for (const item of queue) {
    try {
      const { errors } = await applyReport(item.payload)
      if (errors.length === 0) flushed++
      else stillQueued.push(item)
    } catch {
      stillQueued.push(item)
    }
  }
  await writeQueue(stillQueued)
  return { flushed, remaining: stillQueued.length }
}

export function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('network error') ||
    msg.includes('timeout') ||
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('no internet')
  )
}
