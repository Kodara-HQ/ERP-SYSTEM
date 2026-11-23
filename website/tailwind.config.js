/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: '#064B27',
        deep: '#003B20',
        gold: '#E6B323',
        cream: '#F8F7F0',
        mist: '#F2F4F1',
        ink: '#102117',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['"Source Sans 3"', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 18px 50px rgba(0, 59, 32, 0.12)',
      },
    },
  },
  plugins: [],
};
