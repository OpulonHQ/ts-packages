import type { Brand } from '@opulonjs/admin'

// One brand object for both builds: vite.config.ts (palettes, radius, font, Nuxt UI overrides,
// applied at build time) and main.ts (name and logo).
export const brand = {
  name: 'Fixture host',
  logo: '/admin/logo.svg',
  // Primary and neutral stay the kit default (black/white over neutral grays).
  colors: { secondary: 'brand' },
  palettes: {
    brand: {
      50: '#eef6ff',
      100: '#d9eaff',
      200: '#bcdaff',
      300: '#8ec3ff',
      400: '#59a1ff',
      500: '#337cfc',
      600: '#1d5ef1',
      700: '#1549de',
      800: '#183db4',
      900: '#1a388e',
      950: '#152456',
    },
  },
  radius: '0.5rem',
  ui: { button: { defaultVariants: { size: 'md' } } },
} satisfies Brand
