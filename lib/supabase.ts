import 'react-native-url-polyfill/auto'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// Keep the sign-in alive across a shift.
//
// supabase-js refreshes tokens on a timer, and in React Native that timer does
// NOT survive the app being backgrounded — the OS suspends it. A foreman who
// opens the app at 3pm having last used it at 7am is then carrying an access
// token that expired hours ago, and the first thing that talks to the server
// tells him to sign in. He is signed in; the token just went stale in his pocket.
//
// So the refresh loop is tied to the app's own lifecycle: run while he is
// looking at it, stop when he is not.
AppState.addEventListener('change', (state) => {
  if (state === 'active') void supabase.auth.startAutoRefresh()
  else void supabase.auth.stopAutoRefresh()
})

// The listener above only fires on a CHANGE, so the very first foreground —
// launching the app — would otherwise never start the loop.
if (AppState.currentState === 'active') void supabase.auth.startAutoRefresh()
