/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './components/**/*.{vue,js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './app.vue',
    './error.vue',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      letterSpacing: {
        widest: '0.18em',
      },
      colors: {
        // Both `accent` and the full zinc ramp resolve through CSS variables so
        // they can be re-themed at runtime via :root style overrides. Defaults
        // (defined in assets/css/main.css) match the original amber + zinc look.
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          dim:     'rgb(var(--c-accent-dim) / <alpha-value>)',
        },
        zinc: {
          50:  'rgb(var(--c-zinc-50)  / <alpha-value>)',
          100: 'rgb(var(--c-zinc-100) / <alpha-value>)',
          200: 'rgb(var(--c-zinc-200) / <alpha-value>)',
          300: 'rgb(var(--c-zinc-300) / <alpha-value>)',
          400: 'rgb(var(--c-zinc-400) / <alpha-value>)',
          500: 'rgb(var(--c-zinc-500) / <alpha-value>)',
          600: 'rgb(var(--c-zinc-600) / <alpha-value>)',
          700: 'rgb(var(--c-zinc-700) / <alpha-value>)',
          800: 'rgb(var(--c-zinc-800) / <alpha-value>)',
          900: 'rgb(var(--c-zinc-900) / <alpha-value>)',
          950: 'rgb(var(--c-zinc-950) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}
