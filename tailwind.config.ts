import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "!./src/**/*.test.{ts,tsx}",
    "!./src/**/*.spec.{ts,tsx}",
    "!./src/**/__tests__/**",
    "!./src/test/**",
    "!./tests/**",
    "!./api/**/*.test.ts",
    "!./api_legacy/**/*.test.ts",
  ],
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
      // Responsive Grid System (12 columns)
      screens: {
        "xs": "360px",   // Mobile small
        "sm": "640px",   // Mobile
        "md": "768px",   // Tablet
        "lg": "1024px",  // Desktop small
        "xl": "1280px",  // Desktop
        "2xl": "1536px", // Desktop large
      },
      colors: {
        // Backgrounds
        background: "hsl(var(--background))",
        "background-secondary": "hsl(var(--background-secondary))",
        "background-tertiary": "hsl(var(--background-tertiary))",
        
        // Text Colors
        text: "hsl(var(--text))",
        "text-secondary": "hsl(var(--text-secondary))",
        "text-tertiary": "hsl(var(--text-tertiary))",
        "text-muted": "hsl(var(--text-muted))",
        
        // Foreground (kept for compatibility)
        foreground: "hsl(var(--foreground))",
        
        // Borders
        border: "hsl(var(--border))",
        "border-light": "hsl(var(--border-light))",
        "border-dark": "hsl(var(--border-dark))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        
        // Primary (Neutral)
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        
        // Secondary
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        
        // Destructive
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        
        // Success
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          light: "hsl(var(--success-light))",
          dark: "hsl(var(--success-dark))",
        },
        
        // Warning
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        
        // Error
        error: {
          DEFAULT: "hsl(var(--error))",
          foreground: "hsl(var(--error-foreground))",
          light: "hsl(var(--error-light))",
          dark: "hsl(var(--error-dark))",
        },
        
        // Info
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        
        // Muted
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        
        // Accent
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        
        // Accent Blue (for specific highlight elements)
        "accent-blue": {
          DEFAULT: "hsl(var(--accent-blue))",
          foreground: "hsl(var(--accent-blue-foreground))",
        },
        
        // Popover
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        
        // Card
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        
        // Sidebar
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
        
        // Backdrop
        backdrop: "hsl(var(--backdrop))",
        
        // Neutral Palette (complete scale)
        neutral: {
          50: "#fafafa",
          100: "#f5f5f5",
          200: "#e5e5e5",
          300: "#d4d4d4",
          400: "#a3a3a3",
          500: "#737373",
          600: "#525252",
          700: "#404040",
          800: "#262626",
          900: "#171717",
        },
        
        // Chart Colors
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
      },
      fontFamily: {
        sans: ["var(--font-family)", "ui-sans-serif", "system-ui", "sans-serif"],
        scarface: ["Scarface", "serif"],
      },
      fontSize: {
        xs: ["var(--font-size-xs)", { lineHeight: "1.5" }],
        sm: ["var(--font-size-sm)", { lineHeight: "1.5" }],
        base: ["var(--font-size-base)", { lineHeight: "1.5" }],
        lg: ["var(--font-size-lg)", { lineHeight: "1.6" }],
        xl: ["var(--font-size-xl)", { lineHeight: "1.4" }],
        "2xl": ["var(--font-size-2xl)", { lineHeight: "1.33" }],
        "3xl": ["var(--font-size-3xl)", { lineHeight: "1.25" }],
        "4xl": ["var(--font-size-4xl)", { lineHeight: "1.2" }],
      },
      spacing: {
        xs: "var(--spacing-xs)",
        sm: "var(--spacing-sm)",
        md: "var(--spacing-md)",
        lg: "var(--spacing-lg)",
        xl: "var(--spacing-xl)",
        "2xl": "var(--spacing-2xl)",
        "3xl": "var(--spacing-3xl)",
        18: "var(--spacing-18)",
        88: "var(--spacing-88)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        smooth: "var(--easing)",
      },
      boxShadow: {
        micro: "var(--shadow-micro)",
        subtle: "var(--shadow-subtle)",
        medium: "var(--shadow-medium)",
        large: "var(--shadow-large)",
        glow: "var(--shadow-glow)",
        intense: "var(--shadow-intense)",
      },
      zIndex: {
        modal: "var(--z-modal)",
        dropdown: "var(--z-dropdown)",
        header: "var(--z-header)",
        sidebar: "var(--z-sidebar)",
        fab: "var(--z-floating-action)",
      },
      borderRadius: {
        xl: "var(--radius-lg)",
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "fade-in": {
          "0%": {
            opacity: "0",
            transform: "translateY(10px)"
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)"
          }
        },
        "slide-up": {
          "0%": {
            opacity: "0",
            transform: "translateY(20px)"
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)"
          }
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "slide-up": "slide-up 0.4s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
