import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { SessionProvider, useSession } from '@/lib/session-context'
import { useNetworkStatus } from '@/lib/use-network'
import { flushQueue } from '@/lib/offline-queue'
import { flushSafetyQueue } from '@/lib/safety-queue'
import { OfflineBanner } from '@/components/OfflineBanner'
import { colors } from '@/lib/theme'

function RootNavigator() {
  const { session, loading } = useSession()
  const router = useRouter()
  const segments = useSegments()
  const online = useNetworkStatus()

  useEffect(() => {
    if (loading) return
    const inAuthGroup = segments[0] === '(auth)'
    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)')
    }
  }, [session, loading, segments])

  // Sync any reports that were saved offline, whenever we're online (mount + on
  // reconnect + on app foreground, since the probe re-checks then).
  useEffect(() => {
    if (session && online) {
      void flushQueue()
      void flushSafetyQueue() // separate queue — safety never rides the payroll path
    }
  }, [session, online])

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      {session && !online && <OfflineBanner />}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="log-today/[jobId]"
          options={{ headerShown: false, animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="wrapup/[jobId]"
          options={{ headerShown: false, animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="history/[jobId]"
          options={{ headerShown: false, animation: 'slide_from_right' }}
        />
      </Stack>
    </View>
  )
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </SessionProvider>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
})
