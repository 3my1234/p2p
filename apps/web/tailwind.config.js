/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        panel: "#ffffff",
        line: "#d1d5db",
        brand: "#0f766e",
        accent: "#b45309"
      }
    }
  },
  plugins: []
};

