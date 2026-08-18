import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DEFAULT_SETTINGS, type Settings } from '@shared/types';
import { http } from '@/lib/http';
import { detailOf, messageOf } from '@/lib/http';

const settingsApi = {
  get: () => http.get<Settings>('/api/settings'),
  patch: (patch: Partial<Settings>) => http.patch<Settings>('/api/settings', patch),
  reset: () => http.post<Settings>('/api/settings/reset')
};

/**
 * Applies the appearance settings to the document root.
 *
 * Attributes on <html> rather than inline styles or a class-per-option: the CSS in themes.css keys
 * off them, so changing a preference is one attribute write and the browser repaints. No component
 * needs to know a theme changed, which is why a colour switch is instant across the whole app.
 */
function applyToDocument(settings: Settings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.accent = settings.accent;
  root.dataset.density = settings.density;
  // Lets the browser style form controls and scrollbars to match, which CSS variables cannot reach.
  root.style.colorScheme = settings.theme;
}

/**
 * One hook, used by the settings page to edit and by the shell to apply.
 *
 * Updates are optimistic: appearance should feel instant, and a failed write is reverted with the
 * server's own message rather than left to diverge silently.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const loadedSettings = await settingsApi.get();
        setSettings(loadedSettings);
        applyToDocument(loadedSettings);
      } catch {
        // A settings read failing must not stop the app; defaults are already applied.
        applyToDocument(DEFAULT_SETTINGS);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const update = useCallback(
    async (patch: Partial<Settings>) => {
      const previous = settings;
      const optimistic = { ...settings, ...patch };
      setSettings(optimistic);
      applyToDocument(optimistic);
      try {
        const saved = await settingsApi.patch(patch);
        setSettings(saved);
        applyToDocument(saved);
      } catch (err) {
        setSettings(previous);
        applyToDocument(previous);
        toast.error(messageOf(err), { description: detailOf(err) });
      }
    },
    [settings]
  );

  const reset = useCallback(async () => {
    try {
      const saved = await settingsApi.reset();
      setSettings(saved);
      applyToDocument(saved);
      toast.success('Settings reset to defaults');
    } catch (err) {
      toast.error(messageOf(err), { description: detailOf(err) });
    }
  }, []);

  return { settings, loaded, update, reset };
}
