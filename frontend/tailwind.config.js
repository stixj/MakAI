const config = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        "surface-subtle": "var(--surface-subtle)",
        ink: "var(--text-primary)",
        "ink-secondary": "var(--text-secondary)",
        "ink-tertiary": "var(--text-tertiary)",
        "border-subtle": "var(--border-subtle)",
        brand: "var(--brand)",
        "brand-hover": "var(--brand-hover)",
        "fit-strong-bg": "var(--fit-strong-bg)",
        "fit-strong-text": "var(--fit-strong-text)",
        "fit-potential-bg": "var(--fit-potential-bg)",
        "fit-potential-text": "var(--fit-potential-text)",
        "fit-low-bg": "var(--fit-low-bg)",
        "fit-low-text": "var(--fit-low-text)",
        danger: "var(--danger)",
        "danger-hover": "var(--danger-hover)",
        "danger-bg": "var(--danger-bg)",
        scrim: "var(--scrim)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        display: ["Poppins", "Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
      fontSize: {
        xs: ["calc(0.8125rem * var(--text-scale, 1))", { lineHeight: "calc(1.125rem * var(--text-scale, 1))" }],
        sm: ["calc(0.9375rem * var(--text-scale, 1))", { lineHeight: "calc(1.375rem * var(--text-scale, 1))" }],
        base: ["calc(1.0625rem * var(--text-scale, 1))", { lineHeight: "calc(1.625rem * var(--text-scale, 1))" }],
        lg: ["calc(1.1875rem * var(--text-scale, 1))", { lineHeight: "calc(1.75rem * var(--text-scale, 1))" }],
        xl: ["calc(1.3125rem * var(--text-scale, 1))", { lineHeight: "calc(1.875rem * var(--text-scale, 1))" }],
        "2xl": ["calc(1.625rem * var(--text-scale, 1))", { lineHeight: "calc(2.125rem * var(--text-scale, 1))" }],
        "3xl": ["calc(2rem * var(--text-scale, 1))", { lineHeight: "calc(2.5rem * var(--text-scale, 1))" }],
        "4xl": ["calc(2.25rem * var(--text-scale, 1))", { lineHeight: "calc(2.5rem * var(--text-scale, 1))" }],
        "5xl": ["calc(3rem * var(--text-scale, 1))", { lineHeight: "1" }],
        "6xl": ["calc(3.75rem * var(--text-scale, 1))", { lineHeight: "1" }],
        "7xl": ["calc(4.5rem * var(--text-scale, 1))", { lineHeight: "1" }],
        "8xl": ["calc(6rem * var(--text-scale, 1))", { lineHeight: "1" }],
        "9xl": ["calc(8rem * var(--text-scale, 1))", { lineHeight: "1" }],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(28, 36, 33, 0.04), 0 6px 20px rgba(28, 36, 33, 0.045)",
        "soft-hover": "0 2px 4px rgba(28, 36, 33, 0.04), 0 10px 28px rgba(28, 36, 33, 0.075)",
        popover: "0 8px 24px rgba(28, 36, 33, 0.10)",
        dialog: "0 20px 56px rgba(28, 36, 33, 0.16)",
      },
    },
  },
  plugins: [],
};

export default config;
