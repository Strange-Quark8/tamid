import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,  // Exposes on your local network so your phone can access
    port: 5173,
  },
})
