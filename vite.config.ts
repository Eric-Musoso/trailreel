import { defineConfig, loadEnv } from 'vite';
import { stravaPlugin } from './server/strava.ts';

export default defineConfig(({ mode }) => {
  // Only STRAVA_* variables are read; they stay on the dev/preview server and never reach the browser bundle.
  const env = loadEnv(mode, process.cwd(), 'STRAVA_');
  return {
    plugins: [stravaPlugin(env)],
    server: { port: 5173, host: 'localhost' },
    preview: { port: 4173, host: 'localhost' },
    build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  };
});
