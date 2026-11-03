import { createTheme } from '@mantine/core'

const fontFamily = "system-ui, -apple-system, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', Meiryo, sans-serif"

export const theme = createTheme({
  primaryColor: 'teal',
  // Shade 9 keeps white text on filled colors at 4.5:1 or more (WCAG 1.4.3).
  primaryShade: { light: 9, dark: 9 },
  fontFamily,
  headings: { fontFamily, fontWeight: '700' },
  defaultRadius: 'md',
  respectReducedMotion: true,
})
