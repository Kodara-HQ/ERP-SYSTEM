import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const api = env.VITE_API_PROXY || 'http://127.0.0.1:4000';
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': { target: api, changeOrigin: true },
        '/sitemap.xml': { target: api, changeOrigin: true, rewrite: () => '/api/v1/public/website/sitemap.xml' },
        '/robots.txt': { target: api, changeOrigin: true, rewrite: () => '/api/v1/public/website/robots.txt' },
      },
    },
  };
});
