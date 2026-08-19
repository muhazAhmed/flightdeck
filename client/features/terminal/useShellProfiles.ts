import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ShellProfile } from '@shared/types';
import { http, detailOf, messageOf } from '@/lib/http';

interface ShellsResponse {
  profiles: ShellProfile[];
  defaultId: string;
}

/**
 * The shells this machine actually has.
 *
 * The chosen id is passed in rather than read here: settings are owned by the shell (one copy, one
 * fetch, one place that writes the document attributes), and a second `useSettings` would quietly
 * diverge from it.
 *
 * Until the list arrives `selectedId` is null, which makes the server pick its own default — the
 * terminal never waits on this request to start.
 */
export function useShellProfiles(savedId: string) {
  const [profiles, setProfiles] = useState<ShellProfile[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await http.get<ShellsResponse>('/api/terminal/shells');
        setProfiles(response.profiles);
        setDefaultId(response.defaultId);
      } catch (err) {
        // No picker rather than no terminal: the server still opens its default shell.
        toast.error(messageOf(err), { description: detailOf(err) });
      }
    })();
  }, []);

  // A saved id that no longer resolves (shell uninstalled, WSL distro removed) falls back to the
  // detected default rather than being sent to the server and rejected.
  const selectedId = profiles.some((profile) => profile.id === savedId) ? savedId : defaultId;

  return { profiles, selectedId };
}
