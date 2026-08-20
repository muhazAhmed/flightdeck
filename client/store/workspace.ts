import { create } from 'zustand';

/**
 * Which whole-pane view is showing.
 *
 * One field rather than a boolean per view. Three mutually-exclusive booleans can represent states that
 * must never happen — settings *and* the deck open at once leaves the user with two "back" affordances
 * that disagree — and every new view would add another pair of writes to keep in sync. Here the
 * exclusivity is the type.
 */
export type View = 'workspace' | 'deck' | 'usage' | 'pr' | 'settings';

/**
 * Selection and layout — the only genuinely global state. Server data (projects, chats,
 * git status) is fetched where it is used rather than mirrored here; two copies of the
 * same list is how a UI starts lying to its user.
 */
interface WorkspaceState {
  selectedProjectId: string | null;
  selectedChatId: string | null;
  view: View;
  sidebarCollapsed: boolean;
  changesCollapsed: boolean;
  paletteOpen: boolean;
  terminalOpen: boolean;
  /**
   * A command waiting to be typed into the terminal.
   *
   * A queue of one, because the terminal may not be open yet: `runInTerminal` opens the drawer and leaves the command
   * here, and the terminal types it once its socket is ready and clears it. Without the queue the command would be
   * written to a socket that does not exist yet and vanish.
   */
  pendingCommand: string | null;

  selectProject: (projectId: string | null) => void;
  selectChat: (chatId: string | null) => void;
  setView: (view: View) => void;
  /** Open `view`, or return to the workspace if it is already showing. */
  toggleView: (view: View) => void;
  toggleSidebar: () => void;
  toggleChanges: () => void;
  setPaletteOpen: (open: boolean) => void;
  toggleTerminal: () => void;
  setTerminalOpen: (open: boolean) => void;
  /** Open the terminal and type `command` into it, exactly as if it had been typed by hand. */
  runInTerminal: (command: string) => void;
  clearPendingCommand: () => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  selectedProjectId: null,
  selectedChatId: null,
  view: 'workspace',
  sidebarCollapsed: false,
  changesCollapsed: false,
  paletteOpen: false,
  terminalOpen: false,
  pendingCommand: null,

  // Changing project always clears the chat: a chat id from another project would point
  // the transcript at one repo and the Changes panel at a different one.
  selectProject: (selectedProjectId) => set({ selectedProjectId, selectedChatId: null }),
  selectChat: (selectedChatId) => set({ selectedChatId }),
  setView: (view) => set({ view }),
  toggleView: (view) => set((s) => ({ view: s.view === view ? 'workspace' : view })),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleChanges: () => set((s) => ({ changesCollapsed: !s.changesCollapsed })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
  runInTerminal: (command) => set({ terminalOpen: true, pendingCommand: command }),
  clearPendingCommand: () => set({ pendingCommand: null })
}));
