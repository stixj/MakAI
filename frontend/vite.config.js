import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { sharedLocalPlugin } from './server/sharedLocal.js';
import { localProfileBuilderPlugin } from './server/localProfileBuilder.js';
import { localJobsPlugin } from './server/localJobs.js';
import { localProfilesPlugin } from './server/localProfiles.js';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, frontendRoot);
  const source = mode === 'cloud' ? 'cloud' : process.env.VITE_JOB_SOURCE || frontendEnv.VITE_JOB_SOURCE;
  const local = source === 'local';
  const shared = local && frontendEnv.VITE_LOCAL_STORAGE !== 'files';
  const backendEnv = local ? loadEnv(mode, projectRoot, ['DATABASE_URL', 'TURSO_AUTH_TOKEN', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'LLM_PROVIDER', 'PROFILE_LLM_PROVIDER', 'PROFILE_GEMINI_MODEL', 'MAKAI_GITHUB_TOKEN', 'MAKAI_GITHUB_REPOSITORY']) : {};
  return {
    base: process.env.VITE_BASE_PATH || '/',
    build: { outDir: mode === 'cloud' ? 'dist-cloud' : 'dist' },
    define: { 'import.meta.env.VITE_SHARED_STORAGE': JSON.stringify(shared), ...(mode === 'cloud' ? { 'import.meta.env.VITE_JOB_SOURCE': JSON.stringify('cloud') } : {}) },
    plugins: [react(), ...(local ? [localProfileBuilderPlugin({ ...backendEnv, ...Object.fromEntries(['OPENAI_API_KEY', 'OPENAI_MODEL', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'LLM_PROVIDER', 'PROFILE_LLM_PROVIDER', 'PROFILE_GEMINI_MODEL'].filter(key => process.env[key]).map(key => [key, process.env[key]])) }), ...(shared ? [sharedLocalPlugin(projectRoot, { ...backendEnv, ...Object.fromEntries(['DATABASE_URL', 'TURSO_AUTH_TOKEN', 'MAKAI_GITHUB_TOKEN', 'MAKAI_GITHUB_REPOSITORY','OPENAI_API_KEY','OPENAI_MODEL','GEMINI_API_KEY','GEMINI_MODEL','LLM_PROVIDER','PROFILE_LLM_PROVIDER','PROFILE_GEMINI_MODEL'].filter(key => process.env[key]).map(key => [key, process.env[key]])) })] : [localProfilesPlugin(projectRoot), localJobsPlugin({
      url: backendEnv.DATABASE_URL?.trim(), authToken: backendEnv.TURSO_AUTH_TOKEN?.trim(),
    })])] : [])],
    ...(local ? {
      server: { host: '127.0.0.1', port: 5173, strictPort: true },
      preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    } : {}),
  };
});
