import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoBase = process.env.GITHUB_PAGES === 'true' ? '/malazan-mechanical-map/' : '/';

export default defineConfig({
  base: repoBase,
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5177 },
  preview: { host: '0.0.0.0', port: 4177 },
});
