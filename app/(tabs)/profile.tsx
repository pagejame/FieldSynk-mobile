import { View, Text, StyleSheet } from 'react-native'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { useSession } from '@/lib/session-context'
import { colors, fontSize, spacing } from '@/lib/theme'

export default function ProfileScreen() {
  const { session, signOut } = useSession()
  const email = session?.user?.email ?? ''

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>
      <View style={styles.body}>
        <Card>
          <Text style={styles.label}>Signed in as</Text>
          <Text style={styles.email}>{email}</Text>
        </Card>
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
        <Text style={styles.version}>FieldSynk • v1.0.0</Text>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.textPrimary },
  body: { padding: spacing.md, gap: spacing.md },
  label: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  email: { fontSize: fontSize.lg, color: colors.textPrimary, fontWeight: '600', marginTop: 4 },
  version: { textAlign: 'center', color: colors.textMuted, fontSize: fontSize.sm, marginTop: spacing.md },
})
