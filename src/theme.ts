import { Anchor, createTheme, virtualColor, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core'

// Mincho headings over a Gothic body. The Japanese faces come first in the headings, so
// their digits are lining figures and not the old-style figures of Latin serifs.
const fontFamily = "system-ui, -apple-system, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', Meiryo, sans-serif"
const headingFamily = "'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', 'Times New Roman', serif"

// Warm grays from ivory to slate. Text and borders take these instead of cool grays.
const gray: MantineColorsTuple = [
  '#FAF9F5',
  '#F5F4ED',
  '#F0EEE6',
  '#E8E6DC',
  '#D1CFC5',
  '#B0AEA5',
  '#87867F',
  '#5E5D59',
  '#3D3D3A',
  '#262624',
]

// Dark mode surfaces and text: 0 is text, 7 the cards, 8 the page.
const dark: MantineColorsTuple = [
  '#E8E6DC',
  '#C2C0B6',
  '#9C9A92',
  '#73726C',
  '#4D4C48',
  '#3D3D3A',
  '#30302E',
  '#262624',
  '#1F1E1D',
  '#141413',
]

// Ink fills buttons and the chosen tab: slate on light, ivory on dark.
const ink: MantineColorsTuple = [
  '#FAF9F5',
  '#F0EEE6',
  '#E8E6DC',
  '#D1CFC5',
  '#B0AEA5',
  '#87867F',
  '#5E5D59',
  '#3D3D3A',
  '#262624',
  '#141413',
]
const inkOnDark: MantineColorsTuple = [
  '#141413',
  '#262624',
  '#3D3D3A',
  '#5E5D59',
  '#87867F',
  '#B0AEA5',
  '#D1CFC5',
  '#E8E6DC',
  '#F0EEE6',
  '#FAF9F5',
]

// What is fine (on time, no shortage, done): a muted green that sits with the warm grays.
const teal: MantineColorsTuple = [
  '#F1F5EC',
  '#E1EAD6',
  '#C8D8B5',
  '#A9C28D',
  '#8CAB6A',
  '#73944F',
  '#5F7D40',
  '#4B6633',
  '#3A5027',
  '#2C3D1E',
]

// What needs attention soon: clay instead of a bright orange.
const orange: MantineColorsTuple = [
  '#FBF0EB',
  '#F6DDD2',
  '#EEC0AC',
  '#E59E82',
  '#DD8162',
  '#D97757',
  '#C2643F',
  '#A8532F',
  '#8C4325',
  '#6E341C',
]

export const theme = createTheme({
  colors: {
    gray,
    dark,
    teal,
    orange,
    ink,
    inkOnDark,
    primary: virtualColor({ name: 'primary', light: 'ink', dark: 'inkOnDark' }),
  },
  primaryColor: 'primary',
  // Shade 9 keeps text on filled colors at 4.5:1 or more (WCAG 1.4.3); autoContrast picks
  // slate text where a fill is light, as the primary fill is in dark mode.
  primaryShade: { light: 9, dark: 9 },
  autoContrast: true,
  black: '#141413',
  white: '#FFFFFF',
  fontFamily,
  headings: { fontFamily: headingFamily, fontWeight: '500' },
  defaultRadius: 'md',
  respectReducedMotion: true,
  // A link differs from the text around it by its underline as well as its color (WCAG 1.4.1).
  components: {
    Anchor: Anchor.extend({ defaultProps: { underline: 'always' } }),
  },
})

// Links are blue in both schemes, about 6:1 on white and 8:1 on the dark cards, instead of the
// primary ink, which matches the text around them. In light mode Mantine colors text with the
// darkest step, which reads as near black for the green and the clay; one or two steps
// lighter keep their hue at 5:1 or more on white.
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--mantine-color-anchor': 'var(--mantine-color-blue-text)',
    '--mantine-color-teal-text': 'var(--mantine-color-teal-7)',
    '--mantine-color-orange-text': 'var(--mantine-color-orange-7)',
  },
  dark: {
    '--mantine-color-anchor': 'var(--mantine-color-blue-text)',
  },
})
