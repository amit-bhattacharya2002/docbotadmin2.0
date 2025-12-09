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
          montserrat: ['var(--font-montserrat)', 'sans-serif'],
          sans: ['var(--font-montserrat)', 'sans-serif'],
        },
      },
    },
    plugins: [
      // any plugins you use, e.g. forms, typography, etc.
      // require('@tailwindcss/forms'),
      // require('@tailwindcss/typography'),
    ],
  };
  