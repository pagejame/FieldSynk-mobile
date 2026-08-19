import { forwardRef } from 'react'
import {
  TextInput,
  Text,
  View,
  StyleSheet,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
  type TextInputProps,
} from 'react-native'
import { colors, radius, fontSize, spacing } from '@/lib/theme'

type Props = {
  label?: string
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  secureTextEntry?: boolean
  keyboardType?: KeyboardTypeOptions
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  autoCorrect?: boolean
  multiline?: boolean
  numberOfLines?: number
  editable?: boolean
  returnKeyType?: ReturnKeyTypeOptions
  onSubmitEditing?: () => void
  blurOnSubmit?: boolean
  /** iOS: what this field IS, so Keychain offers to save and fill it. Without
   *  it the phone never offers to remember a login, which is the difference
   *  between signing in once and signing in every day. */
  textContentType?: TextInputProps['textContentType']
  /** Android + web equivalent of the above. */
  autoComplete?: TextInputProps['autoComplete']
}

export const Input = forwardRef<TextInput, Props>(function Input(
  {
    label,
    value,
    onChangeText,
    placeholder,
    secureTextEntry,
    keyboardType = 'default',
    autoCapitalize = 'sentences',
    autoCorrect,
    multiline = false,
    numberOfLines = 1,
    editable = true,
    returnKeyType,
    onSubmitEditing,
    blurOnSubmit,
    textContentType,
    autoComplete,
  },
  ref,
) {
  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
        style={[
          styles.input,
          multiline ? { minHeight: 22 * numberOfLines, textAlignVertical: 'top' as const } : null,
          !editable ? styles.disabled : null,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        multiline={multiline}
        numberOfLines={multiline ? numberOfLines : undefined}
        editable={editable}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        blurOnSubmit={blurOnSubmit}
        textContentType={textContentType}
        autoComplete={autoComplete}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  label: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.textPrimary,
    fontSize: fontSize.md,
    minHeight: 48,
  },
  disabled: { opacity: 0.45 },
})
