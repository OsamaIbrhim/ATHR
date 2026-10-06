import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./app/**/*.{ts,tsx}','./components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { athr: '#111827', accent: '#f59e0b', surface: '#f6f6f7' },
      fontFamily: { sans: ['var(--font-cairo)', 'Segoe UI', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
export default config
