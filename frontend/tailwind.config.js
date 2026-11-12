/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FDFAD5',
        khaki: '#D9D7B6',
        olive: '#878571',
        ink: '#2C2B1C',
        navy: '#3E3C28',
        pine: '#545233',
        brass: '#878571',
        canvas: '#FDFAD5',
        line: '#D9D7B6',
        slate: {
          50: '#FBF8E4',
          100: '#F3F0D2',
          200: '#FDFAD5',
          300: '#E4E1C4',
          400: '#6E6C56',
          500: '#6A6854',
          600: '#545233',
          700: '#3E3C28',
          800: '#2C2B1C',
          900: '#1C1B12',
        },
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(62, 60, 40, 0.08)',
      },
    },
  },
  plugins: [],
};
