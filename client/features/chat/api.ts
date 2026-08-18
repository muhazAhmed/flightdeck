import { http } from '@/lib/http';
import type { Chat, PermissionMode, UiEvent } from '@shared/types';

export const chatsApi = {
  list: (projectId: string) => http.get<Chat[]>(`/api/chats?projectId=${encodeURIComponent(projectId)}`),
  create: (projectId: string, title?: string, parentChatId?: string) =>
    http.post<Chat>('/api/chats', { projectId, title, parentChatId }),
  rename: (id: string, title: string) => http.patch<Chat>(`/api/chats/${id}`, { title }),
  setMode: (id: string, permissionMode: PermissionMode) =>
    http.patch<Chat>(`/api/chats/${id}`, { permissionMode }),
  remove: (id: string) => http.delete<{ ok: true }>(`/api/chats/${id}`),
  abort: (id: string) => http.post<{ ok: true }>(`/api/chats/${id}/abort`),
  running: () => http.get<string[]>('/api/chats/running'),

  /** Past messages, replayed from Claude Code's own transcript — Flight Deck stores none
   *  of its own. Empty for a chat that has never run. */
  history: (id: string) => http.get<UiEvent[]>(`/api/chats/${id}/history`)
};
