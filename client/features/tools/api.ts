import type { ToolStatus } from '@shared/types';
import { http } from '@/lib/http';

export const toolsApi = {
  /**
   * `refresh` re-probes instead of answering from the cache.
   *
   * The cache exists because `gh auth status` is a network round trip; the escape hatch exists because
   * whoever pressed "check again" has just installed something.
   */
  get: (refresh = false) =>
    http.get<{ tools: ToolStatus[]; checkedAt: string }>(`/api/tools${refresh ? '?refresh=1' : ''}`),
  /**
   * Hand a token to `gh`, which stores it in the system credential store.
   *
   * Nothing keeps it here: not the store, not state.json, not a log. The response is the re-probed status.
   */
  ghLogin: (token: string) =>
    http.post<{ tools: ToolStatus[]; checkedAt: string }>('/api/tools/gh/login', { token })
};
