const config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        secondary: "hsl(var(--secondary))",
        "secondary-foreground": "hsl(var(--secondary-foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        accent: "hsl(var(--accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        "accent-orange": "hsl(var(--accent-orange))",
        "accent-coral": "hsl(var(--accent-coral))",
        border: "hsl(var(--border))",
        ring: "hsl(var(--ring))",
        viatix: {
          ink: "#06282B",
          ink2: "#0C3539",
          teal: "#005C63",
          mint: "#57C7A7",
          sand: "#F4EDE4",
          sand2: "#FBF7F1",
          line: "#E0D6C7",
          muted: "#5C6B6B",
          amber: "#FFB347",
          "amber-hot": "#FF8A3D",
          gold: "#E9C46A",
        },
      },
      borderRadius: {
        "4xl": "2rem",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        display: ["Poppins", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(6, 40, 43, 0.08), 0 1px 2px rgba(6, 40, 43, 0.06)",
        "card-hover": "0 10px 40px rgba(6, 40, 43, 0.12)",
        glass: "0 8px 32px rgba(6, 40, 43, 0.1)",
        float: "0 20px 50px rgba(6, 40, 43, 0.18)",
      },
      backgroundImage: {
        "gradient-glass":
          "linear-gradient(135deg, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0.6) 100%)",
        "gradient-viatix": "linear-gradient(105deg, #FF8A3D, #FFB347 38%, #57C7A7)",
        "gradient-viatix-v": "linear-gradient(to bottom, #FF8A3D, #FFB347 48%, #57C7A7)",
      },
    },
  },
  plugins: [],
};

export default config;
