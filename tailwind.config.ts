import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Manrope", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        warm: {
          DEFAULT: "hsl(var(--warm))",
          foreground: "hsl(var(--warm-foreground))",
          container: "hsl(var(--warm-container))",
          "on-container": "hsl(var(--warm-on-container))",
        },
        pastel: {
          purple: "hsl(var(--pastel-purple))",
          green: "hsl(var(--pastel-green))",
          blue: "hsl(var(--pastel-blue))",
          orange: "hsl(var(--pastel-orange))",
          red: "hsl(var(--pastel-red))",
          yellow: "hsl(var(--pastel-yellow))",
          mint: "hsl(var(--pastel-mint))",
          pink: "hsl(var(--pastel-pink))",
        },
        stage: {
          new: "hsl(var(--stage-new))",
          called: "hsl(var(--stage-called))",
          visit: "hsl(var(--stage-visit))",
          interview: "hsl(var(--stage-interview))",
          offer: "hsl(var(--stage-offer))",
          paid: "hsl(var(--stage-paid))",
          admitted: "hsl(var(--stage-admitted))",
          rejected: "hsl(var(--stage-rejected))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",             /* 8px — ROUND_EIGHT, containers */
        md: "calc(var(--radius) - 2px)", /* 6px */
        sm: "calc(var(--radius) - 4px)", /* 4px — ROUND_FOUR, components */
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "bounce-in": {
          "0%": { opacity: "0", transform: "scale(0.3) translateY(-20px)" },
          "50%": { opacity: "1", transform: "scale(1.05) translateY(0)" },
          "70%": { transform: "scale(0.95)" },
          "100%": { transform: "scale(1)" },
        },
        "score-float": {
          "0%": { opacity: "1", transform: "translateY(0)" },
          "100%": { opacity: "0", transform: "translateY(-40px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "bounce-in": "bounce-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        "score-float": "score-float 2s ease-out forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
