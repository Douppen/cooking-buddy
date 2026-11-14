import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// In dev and preview, /api goes to the local server (cd server && npm start).
const backend = {
  '/api': {target: 'http://localhost:8787'},
};

export default defineConfig({
  plugins: [react()],
  server: {proxy: backend},
  preview: {proxy: backend},
});
