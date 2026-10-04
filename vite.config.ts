import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // An explicit process environment wins over the .env file, so the browser
  // smoke test can point the dev server at its own API instance.
  const apiPort = process.env.PORT || env.PORT || '4800';

  return {
    plugins: [react()],
    server: {
      host: 'localhost',
      port: 5173,
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
