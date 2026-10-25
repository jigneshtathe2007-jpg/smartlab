/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      colors: {
        navy: { 950: '#050d1f', 900: '#0a1730', 800: '#10224a', 700: '#173063', 600: '#1e3d7d' },
        brand: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' },
      },
      boxShadow: { card: '0 1px 2px rgba(16,34,74,.06), 0 8px 24px -12px rgba(16,34,74,.18)' },
      keyframes: {
        'fade-up': { '0%': { opacity: 0, transform: 'translateY(10px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        'fade-in': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        'scale-in': { '0%': { opacity: 0, transform: 'scale(.96)' }, '100%': { opacity: 1, transform: 'scale(1)' } },
        'slide-in': { '0%': { opacity: 0, transform: 'translateX(24px)' }, '100%': { opacity: 1, transform: 'translateX(0)' } },
        ping2: { '0%': { transform: 'scale(1)', opacity: 0.6 }, '100%': { transform: 'scale(2.4)', opacity: 0 } },
        scan: { '0%,100%': { top: '8%' }, '50%': { top: '88%' } },
      },
      animation: {
        'fade-up': 'fade-up .45s ease-out both', 'fade-in': 'fade-in .3s ease-out both',
        'scale-in': 'scale-in .2s ease-out both', 'slide-in': 'slide-in .3s ease-out both',
        ping2: 'ping2 1.6s cubic-bezier(0,0,.2,1) infinite', scan: 'scan 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
