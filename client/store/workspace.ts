import { create } from 'zustand';

/**
 * Selection and layout — the only genuinely global state. Server data (projects, chats,
 * git status) is fetched where it is used rather than mirrored here; two copies of the
 * same list is how a UI starts lying to its user.
 */
interface WorkspaceState {
  selectedProjectId: string | null;
  selectedChatId: string | null;
  sidebarCollapsed: boolean;
  changesCollapsed: boolean;
  paletteOpen: boolean;

  selectProject: (projectId: string | null) => void;
  selectChat: (chatId: string | null) => void;
  toggleSidebar: () => void;
  toggleChanges: () => void;
  setPaletteOpen: (open: boolean) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  selectedProjectId: null,
  selectedChatId: null,
  sidebarCollapsed: false,
  changesCollapsed: false,
  paletteOpen: false,

  // Changing project always clears the chat: a chat id from another project would point
  // the transcript at one repo and the Changes panel at a different one.
  selectProject: (selectedProjectId) => set({ selectedProjectId, selectedChatId: null }),
  selectChat: (selectedChatId) => set({ selectedChatId }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleChanges: () => set((s) => ({ changesCollapsed: !s.changesCollapsed })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen })
}));
