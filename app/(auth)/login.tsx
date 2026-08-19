import { useState, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  TextInput,
  TouchableOpacity,
} from 'react-native'
import { Screen } from '@/components/Screen'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'
import { supabase } from '@/lib/supabase'
import { colors, fontSize, spacing } from '@/lib/theme'

function loginErrorMessage(msg: string): string {
  const lower = msg.toLowerCase()
  if (lower.includes('invalid login') || lower.includes('invalid credentials'))
    return 'Incorrect email or password.'
  if (lower.includes('email not confirmed')) return 'Please confirm your email before signing in.'
  if (lower.includes('too many requests') || lower.includes('rate limit'))
    return 'Too many attempts. Wait a moment and try again.'
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('connect'))
    return 'No internet connection. Check your signal and try again.'
  return msg
}

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const passwordRef = useRef<TextInput>(null)

  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert('Missing fields', 'Enter your email and password.')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (error) Alert.alert('Sign in failed', loginErrorMessage(error.message))
    } catch {
      Alert.alert('Connection error', 'Unable to connect. Check your internet connection.')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgot() {
    if (!email.trim()) {
      Alert.alert('Enter email', 'Type your email above, then tap Forgot password.')
      return
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      // Land on the web reset page. Without this the link has nowhere to go and
      // the email is a dead end.
      redirectTo: 'https://www.fieldsynk.org/reset-password',
    })
    if (error) Alert.alert('Error', error.message)
    else Alert.alert('Check your email', `A reset link was sent to ${email.trim().toLowerCase()}.`)
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <View style={styles.wordmarkRow}>
              <Text style={styles.wordmarkDark}>Field</Text>
              <Text style={styles.wordmarkBlue}>Synk</Text>
            </View>
            <Text style={styles.tagline}>FIELD REPORTS</Text>
          </View>

          <View style={styles.form}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="name@company.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              // Marks this as the USERNAME of a login. Without it iOS never
              // offers to save the password, so every foreman signs in by hand
              // every time — which is the complaint.
              textContentType="username"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              blurOnSubmit={false}
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
              autoCapitalize="none"
              // The other half. Together these make iOS offer "Save Password"
              // after a successful sign-in, and offer to fill it next time.
              textContentType="password"
              autoComplete="current-password"
              ref={passwordRef}
              returnKeyType="go"
              onSubmitEditing={handleLogin}
            />
            <Button label="Sign in" onPress={handleLogin} loading={loading} style={styles.signIn} />
            <TouchableOpacity onPress={handleForgot} style={styles.forgot}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>Use the same email and password as fieldsynk.org</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    gap: spacing.xl,
  },
  brand: { alignItems: 'center', gap: spacing.sm },
  wordmarkRow: { flexDirection: 'row', alignItems: 'baseline' },
  wordmarkDark: { fontSize: 34, fontWeight: '800', color: colors.textPrimary, letterSpacing: 0.5 },
  wordmarkBlue: { fontSize: 34, fontWeight: '800', color: colors.primary, letterSpacing: 0.5 },
  tagline: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    letterSpacing: 3,
    fontWeight: '600',
  },
  form: { gap: spacing.md },
  signIn: { marginTop: spacing.xs },
  forgot: { alignItems: 'center', paddingVertical: spacing.xs },
  forgotText: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '600' },
  hint: { textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 18 },
})
