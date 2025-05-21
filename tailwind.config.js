// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: 'media',        // or 'class' if you prefer a toggle
    content: [
      './src/**/*.{js,jsx,ts,tsx,html}',
      './pages/**/*.{js,ts,jsx,tsx,html}',
      './components/**/*.{js,ts,jsx,tsx,html}',
    ],
    theme: {
      extend: {
        colors: {
          background: 'var(--background)',
          foreground: 'var(--foreground)',
        },
        fontFamily: {
          sans: ['var(--font-geist-sans)', 'Arial', 'Helvetica', 'sans-serif'],
          mono: ['var(--font-geist-mono)'],
        },
      },
    },
    plugins: [
      // any plugins you use, e.g. forms, typography, etc.
      // require('@tailwindcss/forms'),
      // require('@tailwindcss/typography'),
    ],
  };
  