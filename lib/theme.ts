// FieldSynk mobile — clean light theme in the FieldSynk logo greens (olive + sage).
// Light is deliberate: field crews read this in bright daylight, and it matches the web app.

export const colors = {
  bg: '#f5f7fa',
  surface: '#ffffff',
  surfaceHigh: '#eef2f7',

  border: '#e2e8f0',
  borderStrong: '#cbd5e1',

  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',

  // Primary = FieldSynk olive green (logo), with sage as the light accent
  primary: '#4a5d2f',
  primaryLight: '#7f9c5c',
  primarySoft: 'rgba(74, 93, 47, 0.10)',

  nav: '#ffffff',
  navMuted: '#94a3b8',

  success: '#16a34a',
  successSoft: 'rgba(22, 163, 74, 0.12)',
  warning: '#d97706',
  warningSoft: 'rgba(217, 119, 6, 0.12)',
  error: '#dc2626',
  errorSoft: 'rgba(220, 38, 38, 0.12)',
} as const

export const fontSize = {
  xs: 11,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 22,
  xxxl: 28,
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 9999,
} as const
