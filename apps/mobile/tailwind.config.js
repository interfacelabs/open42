/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './App.{js,ts,tsx}',
    './components/**/*.{js,ts,tsx}',
    './screens/**/*.{js,ts,tsx}',
    './navigation/**/*.{js,ts,tsx}',
    './hooks/**/*.{js,ts,tsx}',
    './store/**/*.{js,ts,tsx}',
  ],

  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: '#ffffff',
        surface: '#ffffff',
        'surface-muted': '#fafafa',
        border: '#eeeeee',
        'border-strong': '#e5e5e5',
        accent: '#1d4dff',
        'accent-muted': '#1a40d9',
        'accent-soft': '#eaeefb',
        success: '#15803d',
        warning: '#b45309',
        destructive: '#b91c1c',
        text: {
          primary: '#171717',
          body: '#404040',
          subtle: '#737373',
          faint: '#a3a3a3',
        },
      },
      fontFamily: {
        sans: ['Geist_400Regular'],
        mono: ['GeistMono_400Regular'],
      },
    },
  },
  plugins: [],
};
