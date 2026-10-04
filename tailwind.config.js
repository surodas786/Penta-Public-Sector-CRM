export default {
  content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}'
],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#0F1E36', light: '#16294A', muted: '#8FA0BD' },
        brand: { DEFAULT: '#0E9384', dark: '#0B7A6E', light: '#E6F5F3' },
        canvas: '#F6F8FA',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
