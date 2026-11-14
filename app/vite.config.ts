import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// In dev and preview, /ws and /api go to the local server (cd server && npm start).
const backend = {
  '/ws': {target: 'ws://localhost:8787', ws: true},
  '/api': {target: 'http://localhost:8787'},
};

export default defineConfig({
  plugins: [react()],
  server: {proxy: backend},
  preview: {proxy: backend},
});
