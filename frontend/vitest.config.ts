import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // E2E_API points the app at a running backend for tests/e2e.test.tsx (skipped when unset).
  test: { env: { VITE_API_URL: process.env.E2E_API ?? '' }, testTimeout: 30000 },
});
