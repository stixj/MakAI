import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { localJobsPlugin } from './server/localJobs.js';
import { localProfilesPlugin } from './server/localProfiles.js';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, frontendRoot);
  const local = frontendEnv.VITE_JOB_SOURCE === 'local';
  const backendEnv = local ? loadEnv(mode, projectRoot, ['DATABASE_URL', 'TURSO_AUTH_TOKEN']) : {};
  return {
    base: process.env.VITE_BASE_PATH || '/',
    plugins: [react(), ...(local ? [localProfilesPlugin(projectRoot), localJobsPlugin({
      url: backendEnv.DATABASE_URL?.trim(), authToken: backendEnv.TURSO_AUTH_TOKEN?.trim(),
    })] : [])],
    ...(local ? {
      server: { host: '127.0.0.1', port: 5173, strictPort: true },
      preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    } : {}),
  };
});
