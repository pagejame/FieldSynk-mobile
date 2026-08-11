import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

type SessionContextType = {
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionContextType>({
  session: null,
  loading: true,
  signOut: async () => {},
})

// Session-only. Data access is scoped by row-level security on the authenticated
// user's company, so the app doesn't need to carry a profile to load jobs/hours.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  async function signOut() {
    await supabase.auth.signOut()
    setSession(null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  return (
    <SessionContext.Provider value={{ session, loading, signOut }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  return useContext(SessionContext)
}
