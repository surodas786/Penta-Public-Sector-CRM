import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // An explicit process environment wins over the .env file, so the browser
  // smoke test can point the dev server at its own API instance.
  const apiPort = process.env.PORT || env.PORT || '4800';
  // Behind a reverse proxy the Host header is the public name, which Vite's
  // DNS-rebinding guard rejects unless it is listed explicitly.
  const appOrigin = process.env.APP_ORIGIN || env.APP_ORIGIN;
  const allowedHosts = appOrigin ? [new URL(appOrigin).hostname] : [];

  return {
    plugins: [react()],
    server: {
      host: 'localhost',
      port: 5173,
      allowedHosts,
      proxy: {
        // The browser always calls same-origin /api/*; Vite forwards it to the
        // API server in development so session cookies stay first-party.
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: false,
        },
      },
    },
  };
});
