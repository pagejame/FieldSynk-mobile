import { View, Text, StyleSheet } from 'react-native'
import { colors, fontSize, spacing } from '@/lib/theme'

export function OfflineBanner() {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>No connection — your reports save here and sync when you&apos;re back online</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.warningSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    alignItems: 'center',
  },
  text: { fontSize: fontSize.xs, fontWeight: '700', color: colors.warning, textAlign: 'center' },
})
