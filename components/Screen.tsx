import { SafeAreaView, StyleSheet, type ViewStyle } from 'react-native'
import { colors } from '@/lib/theme'

type Props = {
  children: React.ReactNode
  style?: ViewStyle
}

export function Screen({ children, style }: Props) {
  return <SafeAreaView style={[styles.root, style]}>{children}</SafeAreaView>
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
})
