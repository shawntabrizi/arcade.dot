/** @type {import('tailwindcss').Config} */
// Polkadot design system → Tailwind mapping. CSS variables (see src/tokens.css)
// drive light/dark/dark-elevated; classes here are semantic only — no `dark:`
// prefixes, no raw color/shadow utilities in components.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // fg tokens — text-* utilities
        primary: "var(--fg-primary)",
        "primary-inverted": "var(--fg-primary-inverted)",
        secondary: "var(--fg-secondary)",
        "secondary-hover": "var(--fg-secondary-hover)",
        "secondary-inverted": "var(--fg-secondary-inverted)",
        tertiary: "var(--fg-tertiary)",
        "tertiary-inverted": "var(--fg-tertiary-inverted)",
        "static-white": "var(--fg-static-white)",
        link: "var(--fg-link)",
        "link-hover": "var(--fg-link-hover)",
        error: "var(--fg-error)",
        warning: "var(--fg-warning)",
        success: "var(--fg-success)",

        // bg tokens — bg-* utilities
        "surface-main": "var(--bg-surface-main)",
        "surface-container": "var(--bg-surface-container)",
        "surface-nested": "var(--bg-surface-nested)",
        "surface-overlay": "var(--bg-surface-overlay)",
        "selection-container-hover": "var(--bg-selection-container-hover)",
        "selection-container-active": "var(--bg-selection-container-active)",
        "action-primary": "var(--bg-action-primary)",
        "action-primary-hover": "var(--bg-action-primary-hover)",
        "action-secondary": "var(--bg-action-secondary)",
        "action-secondary-hover": "var(--bg-action-secondary-hover)",
        "status-error": "var(--bg-status-error)",
        "status-error-hover": "var(--bg-status-error-hover)",
        "status-warning": "var(--bg-status-warning)",
        "status-warning-hover": "var(--bg-status-warning-hover)",
        accent: "var(--bg-accent)",
      },
      borderColor: {
        DEFAULT: "var(--border-default)",
        "default-inverted": "var(--border-default-inverted)",
        error: "var(--border-error)",
        warning: "var(--border-warning)",
        success: "var(--border-success)",
        divider: "var(--border-divider)",
        "divider-tint": "var(--border-divider-tint)",
        indicator: "var(--border-indicator)",
      },
      ringColor: {
        DEFAULT: "var(--border-default)",
        error: "var(--border-error)",
      },
      boxShadow: {
        1: "var(--shadow-1)",
        2: "var(--shadow-2)",
        3: "var(--shadow-3)",
      },
      borderRadius: {
        container: "var(--radius-container)",
        nested: "var(--radius-nested)",
        small: "var(--radius-small)",
      },
    },
  },
  plugins: [],
};
