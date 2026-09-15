import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split the React runtime into a long-lived vendor chunk so app
        // edits don't invalidate the framework bytes in returning
        // visitors' caches. (Vite 8 / Rolldown requires the function form.)
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor';
        },
      },
    },
  },
})
