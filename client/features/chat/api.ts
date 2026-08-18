import { http, RequestError } from '@/lib/http';
import type { Attachment, Chat, DiscoveredSession, PermissionMode, UiEvent, UserInfo } from '@shared/types';

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

/** Base64 rather than multipart: no extra server plugin, and an attachment here is a few hundred
 *  kilobytes of screenshot, not a video. */
async function toBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked to avoid blowing the argument limit of String.fromCharCode on a large file.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Server cap. Checked here too because base64 inflates the body by a third, so a larger file
 *  trips the server's raw body limit and returns a bare 413 instead of a sentence worth reading. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const attachmentApi = {
  /** Saves the bytes on disk and returns the path the agent will read. */
  upload: async (file: File): Promise<Attachment> => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new RequestError(
        0,
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`
      );
    }
    if (file.size === 0) throw new RequestError(0, `${file.name} is empty.`);
    return http.post<Attachment>('/api/attachments', { name: file.name, dataBase64: await toBase64(file) });
  }
};
