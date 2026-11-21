import * as Tooltip from '@radix-ui/react-tooltip';
import { Toaster } from 'sonner';
import { useServerReady } from '@/hooks/useServerReady';
import { AppShell } from './AppShell';
import { ServerWaiting } from './ServerWaiting';

export function App() {
  // The shell mounts only once the API answers, so its first-load requests cannot race the server's start.
  const readiness = useServerReady();

  return (
    <Tooltip.Provider delayDuration={400}>
      {readiness === 'ready' ? <AppShell /> : <ServerWaiting slow={readiness === 'slow'} />}
      <Toaster
        theme="dark"
        position="bottom-right"
        // Errors carry stderr the user may need to read and copy, so they do not expire.
        toastOptions={{
          duration: 4000,
          style: {
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-ui)',
            fontSize: '13px'
          }
        }}
      />
    </Tooltip.Provider>
  );
}
