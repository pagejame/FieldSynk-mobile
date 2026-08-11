import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { colors, radius, spacing } from '@/lib/theme'

type Props = {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  padded?: boolean
}

export function Card({ children, style, padded = true }: Props) {
  return <View style={[styles.card, padded && styles.padded, style]}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  padded: { padding: spacing.md },
})
