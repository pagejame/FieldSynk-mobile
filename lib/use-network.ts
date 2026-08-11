import { useEffect, useRef, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'

// Dependency-free connectivity check: HEAD the Supabase REST endpoint with a short
// timeout, and re-check whenever the app returns to the foreground. Good enough to
// drive the offline banner and trigger a queue flush — no native module needed.
const PROBE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/`

async function probeOnline(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    await fetch(PROBE_URL, { method: 'HEAD', signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export function useNetworkStatus(onReconnect?: () => void): boolean {
  const [online, setOnline] = useState(true)
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)
  const wasOnlineRef = useRef(true)

  useEffect(() => {
    let active = true

    async function check() {
      const result = await probeOnline()
      if (!active) return
      setOnline(result)
      if (result && !wasOnlineRef.current) onReconnect?.()
      wasOnlineRef.current = result
    }

    void check()

    const sub = AppState.addEventListener('change', (nextState) => {
      const comingToForeground = appStateRef.current !== 'active' && nextState === 'active'
      appStateRef.current = nextState
      if (comingToForeground) void check()
    })

    return () => {
      active = false
      sub.remove()
    }
  }, [onReconnect])

  return online
}
