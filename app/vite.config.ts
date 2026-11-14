import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

// In dev and preview, /api goes to the local server (cd server && npm start).
// COOKING_API points it elsewhere, e.g. a second server on another port. (Read through
// globalThis because this config is typechecked without Node's types.)
const env = (globalThis as {process?: {env: Record<string, string | undefined>}}).process?.env;
const backend = {
  '/api': {target: env?.COOKING_API ?? 'http://localhost:8787'},
};

export default defineConfig({
  plugins: [react()],
  server: {proxy: backend},
  preview: {proxy: backend},
});
