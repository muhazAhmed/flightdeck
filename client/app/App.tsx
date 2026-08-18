import * as Tooltip from '@radix-ui/react-tooltip';
import { Toaster } from 'sonner';
import { AppShell } from './AppShell';

export function App() {
  return (
    <Tooltip.Provider delayDuration={400}>
      <AppShell />
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
