export const colors = {
  bg: '#ffffff',
  surface: '#ffffff',
  surfaceMuted: '#fafafa',
  border: '#eeeeee',
  borderStrong: '#e5e5e5',
  textPrimary: '#171717',
  textBody: '#404040',
  textSubtle: '#737373',
  textFaint: '#a3a3a3',
  accent: '#1d4dff',
  accentMuted: '#1a40d9',
  accentSoft: '#eaeefb',
  success: '#15803d',
  warning: '#b45309',
  error: '#b91c1c',
} as const;

export const fonts = {
  sans: 'Geist_400Regular',
  sansMedium: 'Geist_500Medium',
  sansSemi: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const;

export const radii = {
  input: 10,
  card: 8,
  button: 16,
  sheet: 24,
} as const;

export const shadow = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  button: {
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
} as const;
