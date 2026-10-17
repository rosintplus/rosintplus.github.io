/** @type {import('tailwindcss').Config} */
export default {
  // Class-based dark mode so `dark:` variants (e.g. card badge brightness)
  // follow the app theme toggled by applyTheme(), not the OS setting.
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}