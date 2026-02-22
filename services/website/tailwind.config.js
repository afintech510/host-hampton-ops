/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        'hampton-navy':  '#2F343B', // dark grey
        'hampton-blue':  '#8FA8BF', // dusty blue
        'hampton-pink':  '#C7A36B', // muted gold accent
        'hampton-ivory': '#F7F2E8', // cream base
        'hampton-mauve': '#AEB6C2', // soft silver
      },
      fontFamily: {
        serif: ['Playfair Display', 'Georgia', 'serif'],
        sans:  ['Montserrat', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.6s ease-out',
      },
      keyframes: {
        fadeInUp: {
          '0%':   { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
