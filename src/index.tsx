import './index.css';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';

/**
 * Application entry.
 *
 * `import.meta.env.VITE_DEMO_MODE` is replaced with a string literal at build
 * time, so exactly one branch below survives bundling. A production build
 * therefore contains no demo component, no synthetic fixture and no browser
 * storage layer at all — not merely an unreachable one (NFR-001).
 *
 *   npm run dev      / npm run build       -> API mode only
 *   npm run dev:demo / npm run build:demo  -> synthetic demo only
 */
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

const toaster = (
  <Toaster
    position="bottom-right"
    richColors
    closeButton
    toastOptions={{ style: { fontFamily: 'Inter, sans-serif' } }}
  />
);

async function start(): Promise<void> {
  const rootElement = document.getElementById('root');
  if (!rootElement) return;
  const root = ReactDOM.createRoot(rootElement);

  if (DEMO_MODE) {
    const { DemoApp } = await import('./demo/DemoApp');
    root.render(
      <>
        <DemoApp />
        {toaster}
      </>,
    );
    return;
  }

  const { ApiApp } = await import('./app/ApiApp');
  root.render(
    <>
      <ApiApp />
      {toaster}
    </>,
  );
}

void start();
