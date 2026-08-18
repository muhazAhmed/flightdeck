import { http } from '@/lib/http';
import type { Chat, DiscoveredSession, PermissionMode, UiEvent, UserInfo } from '@shared/types';

export const chatsApi = {
  list: (projectId: string) => http.get<Chat[]>(`/api/chats?projectId=${encodeURIComponent(projectId)}`),
  create: (projectId: string, title?: string, parentChatId?: string) =>
    http.post<Chat>('/api/chats', { projectId, title, parentChatId }),

  /** An empty string clears the pin and returns the chat to the CLI's default model. */
  setModel: (id: string, model: string) => http.patch<Chat>(`/api/chats/${id}`, { model }),
  rename: (id: string, title: string) => http.patch<Chat>(`/api/chats/${id}`, { title }),
  setMode: (id: string, permissionMode: PermissionMode) =>
    http.patch<Chat>(`/api/chats/${id}`, { permissionMode }),
  remove: (id: string) => http.delete<{ ok: true }>(`/api/chats/${id}`),
  abort: (id: string) => http.post<{ ok: true }>(`/api/chats/${id}/abort`),
  running: () => http.get<string[]>('/api/chats/running'),

  /** Past messages, replayed from Claude Code's own transcript — Flight Deck stores none
   *  of its own. Empty for a chat that has never run. */
  history: (id: string) => http.get<UiEvent[]>(`/api/chats/${id}/history`),

  /** Sessions on disk for this project that no chat points at yet — started in the IDE, in a
   *  terminal, or by an earlier Flight Deck install. */
  discoverable: (projectId: string) =>
    http.get<DiscoveredSession[]>(`/api/sessions/discoverable?projectId=${encodeURIComponent(projectId)}`),

  /** Adopt one: records its id as a chat so its transcript renders and it can be continued. */
  importSession: (projectId: string, sessionId: string, title?: string) =>
    http.post<Chat>('/api/sessions/import', { projectId, sessionId, title })
};

export const userApi = {
  /** Global git identity — used for the sidebar footer, not for attribution. */
  get: () => http.get<UserInfo>('/api/user')
};
