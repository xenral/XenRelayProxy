import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.5rem" },
    extend: {
      colors: {
        bg: {
          base: "hsl(var(--bg-base) / <alpha-value>)",
          raised: "hsl(var(--bg-raised) / <alpha-value>)",
          inset: "hsl(var(--bg-inset) / <alpha-value>)",
          overlay: "hsl(var(--bg-overlay) / <alpha-value>)",
        },
        line: {
          subtle: "hsl(var(--line-subtle) / <alpha-value>)",
          strong: "hsl(var(--line-strong) / <alpha-value>)",
        },
        ink: {
          1: "hsl(var(--ink-1) / <alpha-value>)",
          2: "hsl(var(--ink-2) / <alpha-value>)",
          3: "hsl(var(--ink-3) / <alpha-value>)",
          inverse: "hsl(var(--ink-inverse) / <alpha-value>)",
        },
        signal: {
          DEFAULT: "hsl(var(--signal) / <alpha-value>)",
          dim: "hsl(var(--signal-dim) / <alpha-value>)",
          ink: "hsl(var(--signal-ink) / <alpha-value>)",
        },
        info: "hsl(var(--info) / <alpha-value>)",
        warn: "hsl(var(--warn) / <alpha-value>)",
        danger: "hsl(var(--danger) / <alpha-value>)",
        success: "hsl(var(--success) / <alpha-value>)",
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', '"Geist"', "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ['"Geist"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"Geist Mono"', '"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
      borderRadius: {
        DEFAULT: "6px",
        lg: "10px",
        xl: "14px",
        "2xl": "20px",
      },
      boxShadow: {
        plate: "0 1px 0 hsl(var(--line-strong) / 0.45), 0 12px 32px -16px rgb(0 0 0 / 0.55)",
        ring: "0 0 0 1px hsl(var(--line-strong) / 0.6)",
        signal: "0 0 0 1px hsl(var(--signal) / 0.55), 0 0 32px -6px hsl(var(--signal) / 0.45)",
      },
      backgroundImage: {
        grid: "linear-gradient(hsl(var(--line-subtle) / 0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--line-subtle) / 0.6) 1px, transparent 1px)",
        "noise": "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.6'/></svg>\")",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 hsl(var(--signal) / 0.55)" },
          "70%": { boxShadow: "0 0 0 14px hsl(var(--signal) / 0)" },
          "100%": { boxShadow: "0 0 0 0 hsl(var(--signal) / 0)" },
        },
        "connect-burst": {
          "0%":   { transform: "scale(1)",    boxShadow: "0 0 0 0 hsl(var(--signal) / 0.85)" },
          "35%":  { transform: "scale(1.07)" },
          "100%": { transform: "scale(1)",    boxShadow: "0 0 0 60px hsl(var(--signal) / 0)" },
        },
        "connect-pulse-once": {
          "0%":   { boxShadow: "0 0 0 0 hsl(var(--signal) / 0.65)", opacity: "1" },
          "70%":  { boxShadow: "0 0 0 28px hsl(var(--signal) / 0)", opacity: "0.4" },
          "100%": { boxShadow: "0 0 0 0 hsl(var(--signal) / 0)",    opacity: "0" },
        },
        "orb-pulse": {
          "0%":   { boxShadow: "0 0 0 0 hsl(var(--warn) / 0.55)", opacity: "0.95" },
          "70%":  { boxShadow: "0 0 0 22px hsl(var(--warn) / 0)", opacity: "0.35" },
          "100%": { boxShadow: "0 0 0 0 hsl(var(--warn) / 0)",    opacity: "0" },
        },
        "orb-dot": {
          "0%, 100%": { transform: "scale(1)",    opacity: "0.95" },
          "50%":      { transform: "scale(1.18)", opacity: "1" },
        },
        "spin-accel": {
          "0%":   { transform: "rotate(0deg)",   animationTimingFunction: "cubic-bezier(0.6, 0.05, 0.95, 0.4)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "spin-fast": {
          from: { transform: "rotate(0deg)" },
          to:   { transform: "rotate(-360deg)" },
        },
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to:   { transform: "rotate(360deg)" },
        },
        "ticker": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        "marquee": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out both",
        "slide-up": "slide-up 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        "pulse-ring": "pulse-ring 2s ease-out infinite",
        "ticker": "ticker 1.4s ease-in-out infinite",
        "marquee": "marquee 18s linear infinite",
        "connect-burst": "connect-burst 1200ms cubic-bezier(0.22, 1, 0.36, 1) 1",
        "connect-pulse-once": "connect-pulse-once 1400ms cubic-bezier(0.22, 1, 0.36, 1) 1 forwards",
        "orb-pulse": "orb-pulse 1.8s cubic-bezier(0.22, 1, 0.36, 1) infinite",
        "orb-dot": "orb-dot 1.4s ease-in-out infinite",
        "spin-accel": "spin-accel 1.6s cubic-bezier(0.6, 0.05, 0.95, 0.4) infinite",
        "spin-fast": "spin-fast 0.7s linear infinite",
        "spin-slow": "spin-slow 2.4s linear infinite",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
