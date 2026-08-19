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
  settingsOpen: boolean;
  /** The cross-project overview. Exclusive with the workspace, like settings. */
  deckOpen: boolean;
  terminalOpen: boolean;

  selectProject: (projectId: string | null) => void;
  selectChat: (chatId: string | null) => void;
  toggleSidebar: () => void;
  toggleChanges: () => void;
  setPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setDeckOpen: (open: boolean) => void;
  toggleDeck: () => void;
  toggleTerminal: () => void;
  setTerminalOpen: (open: boolean) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  selectedProjectId: null,
  selectedChatId: null,
  sidebarCollapsed: false,
  changesCollapsed: false,
  paletteOpen: false,
  settingsOpen: false,
  deckOpen: false,
  terminalOpen: false,

  // Changing project always clears the chat: a chat id from another project would point
  // the transcript at one repo and the Changes panel at a different one.
  selectProject: (selectedProjectId) => set({ selectedProjectId, selectedChatId: null }),
  selectChat: (selectedChatId) => set({ selectedChatId }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleChanges: () => set((s) => ({ changesCollapsed: !s.changesCollapsed })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  // Settings and the deck are mutually exclusive: each takes the whole pane, and leaving one open
  // behind the other gives the user two "back" affordances that disagree. Closing one never opens the
  // other, so both writes are spelled out rather than computed.
  setSettingsOpen: (settingsOpen) =>
    set((s) => (settingsOpen ? { settingsOpen: true, deckOpen: false } : { ...s, settingsOpen: false })),
  setDeckOpen: (deckOpen) =>
    set((s) => (deckOpen ? { deckOpen: true, settingsOpen: false } : { ...s, deckOpen: false })),
  toggleDeck: () => set((s) => ({ deckOpen: !s.deckOpen, settingsOpen: false })),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  setTerminalOpen: (terminalOpen) => set({ terminalOpen })
}));
