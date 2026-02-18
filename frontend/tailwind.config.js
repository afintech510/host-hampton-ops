/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hampton: {
          blush:  '#F2A7B0',
          gold:   '#C9A96E',
          navy:   '#1A2A4A',
          cream:  '#FDF6EE',
          sage:   '#7A9E87',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    }
  },
  plugins: [],
}
