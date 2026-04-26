/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Severity colors - security focused
        critical: {
          DEFAULT: '#DC2626',
          muted: 'rgba(220, 38, 38, 0.2)',
        },
        high: {
          DEFAULT: '#EA580C',
          muted: 'rgba(234, 88, 12, 0.2)',
        },
        medium: {
          DEFAULT: '#F59E0B',
          muted: 'rgba(245, 158, 11, 0.2)',
        },
        low: {
          DEFAULT: '#3B82F6',
          muted: 'rgba(59, 130, 246, 0.2)',
        },
        info: {
          DEFAULT: '#6B7280',
          muted: 'rgba(107, 114, 128, 0.2)',
        },
        success: {
          DEFAULT: '#10B981',
          muted: 'rgba(16, 185, 129, 0.2)',
        },
        // Custom orange/gold from ZeroProof logo
        orange: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FEB800',  // Main brand color
          500: '#EAA900',  // Slightly darker
          600: '#CA8A04',  // Darker
          700: '#A16207',
          800: '#854D0E',
          900: '#713F12',
          950: '#422006',
        },
        // Security accent colors - fire orange
        fire: {
          DEFAULT: '#FEB800',
          50: 'rgba(254, 184, 0, 0.05)',
          100: 'rgba(254, 184, 0, 0.1)',
          200: 'rgba(254, 184, 0, 0.2)',
          300: 'rgba(254, 184, 0, 0.3)',
          400: '#FEB800',
          500: '#EAA900',
          600: '#CA8A04',
          700: '#A16207',
          800: '#854D0E',
          900: '#713F12',
        },
        terminal: {
          green: '#4ADE80',
          amber: '#FBBF24',
          red: '#F87171',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Monaco', 'monospace'],
      },
      boxShadow: {
        'glow-orange': '0 0 20px rgba(254, 184, 0, 0.25)',
        'glow-red': '0 0 20px rgba(239, 68, 68, 0.15)',
        'glow-green': '0 0 20px rgba(16, 185, 129, 0.15)',
        'glow-amber': '0 0 20px rgba(245, 158, 11, 0.15)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { opacity: '0.5' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
