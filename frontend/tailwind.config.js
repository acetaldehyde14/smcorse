/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0066cc',
        'primary-dark': '#004d99',
        'primary-light': '#1a7fd4',
        accent: '#00aaff',
        dark: '#0a0f1c',
        'dark-card': '#0d1525',
        'dark-border': '#1a2540',
        'dark-muted': '#8892a4',
      },
      fontFamily: {
        heading: ['Montserrat', 'sans-serif'],
        body: ['Rajdhani', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-dark': 'linear-gradient(135deg, #0a0f1c 0%, #0d1a2e 100%)',
      },
    },
  },
  plugins: [],
};
