import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { toast } from 'sonner';
import { PanelLeft, PanelRight } from 'lucide-react';
import type { Chat } from '@shared/types';
import { ChangesPanel } from '@/features/changes/ChangesPanel';
import { chatsApi } from '@/features/chat/api';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { ImportSessionDialog } from '@/features/chat/ImportSessionDialog';
import { CommandPalette } from '@/features/command-palette/CommandPalette';
import { DeckPage } from '@/features/deck/DeckPage';
import { UsagePage } from '@/features/usage/UsagePage';
import { AddProjectDialog } from '@/features/projects/AddProjectDialog';
import { ProjectSidebar } from '@/features/projects/ProjectSidebar';
import { useProjects } from '@/features/projects/useProjects';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useSettings } from '@/features/settings/useSettings';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { useUpdateCheck } from '@/features/updates/useUpdateCheck';
import { useHotkey } from '@/hooks/useHotkey';
import { detailOf, messageOf } from '@/lib/http';
import { useWorkspace } from '@/store/workspace';

/**
 * xterm plus its WebGL addon is roughly half the bundle, and the terminal is opt-in — most sessions
 * never open one. Loading it on first use keeps the initial payload to the part everyone needs.
 */
const TerminalDrawer = lazy(() =>
  import('@/features/terminal/TerminalDrawer').then((m) => ({ default: m.TerminalDrawer }))
);

export function AppShell() {
  const { projects, loading, unreachable, add, remove } = useProjects();
  const [chats, setChats] = useState<Chat[]>([]);
  const [runningChatIds, setRunningChatIds] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [importFor, setImportFor] = useState<string | null>(null);
  // Incremented when a run finishes so the Changes panel refetches the files it touched.
  const [gitRevision, setGitRevision] = useState(0);

  const selectedProjectId = useWorkspace((s) => s.selectedProjectId);
  const selectedChatId = useWorkspace((s) => s.selectedChatId);
  const selectChat = useWorkspace((s) => s.selectChat);
  const selectProject = useWorkspace((s) => s.selectProject);
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed);
  const changesCollapsed = useWorkspace((s) => s.changesCollapsed);
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar);
  const toggleChanges = useWorkspace((s) => s.toggleChanges);
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);
  const view = useWorkspace((s) => s.view);
  const setView = useWorkspace((s) => s.setView);
  const toggleView = useWorkspace((s) => s.toggleView);
  const terminalOpen = useWorkspace((s) => s.terminalOpen);
  const toggleTerminal = useWorkspace((s) => s.toggleTerminal);
  const setTerminalOpen = useWorkspace((s) => s.setTerminalOpen);
  const { settings, loaded: settingsLoaded, update: updateSettings, reset: resetSettings } = useSettings();

  // Announces an available update once per launch. The toast's action opens the Updates section, which is
  // where the incoming commits and the button live.
  useUpdateCheck(settingsLoaded && settings.checkForUpdates, () => setView('settings'));

  const project = projects.find((p) => p.id === selectedProjectId) ?? null;
  const chat = chats.find((c) => c.id === selectedChatId) ?? null;

  const loadChats = useCallback(async (projectId: string | null) => {
    if (!projectId) {
      setChats([]);
      return [];
    }
    try {
      const loaded = await chatsApi.list(projectId);
      setChats(loaded);
      return loaded;
    } catch (error) {
      toast.error(messageOf(error), { description: detailOf(error) });
      return [];
    }
  }, []);

  const createChat = useCallback(
    async (projectId: string) => {
      try {
        const created = await chatsApi.create(projectId);
        setChats((current) => [...current, created]);
        selectChat(created.id);
      } catch (error) {
        toast.error(messageOf(error), { description: detailOf(error) });
      }
    },
    [selectChat]
  );

  /**
   * Selecting a project opens a chat rather than an empty panel: the most recently used one, or a
   * fresh chat when the project has none. "No chat open" was a dead end that made every project
   * click cost a second click for no decision.
   *
   * `autoOpened` guards against a loop — if creation fails, the effect must not keep retrying for
   * the same project on every render.
   */
  const autoOpened = useRef<string | null>(null);

  useEffect(() => {
    const projectId = selectedProjectId;
    if (!projectId) {
      autoOpened.current = null;
      void loadChats(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const loaded = await loadChats(projectId);
      if (cancelled || autoOpened.current === projectId) return;
      autoOpened.current = projectId;

      const mostRecent = [...loaded].sort(
        (a, b) =>
          Date.parse(b.lastMessageAt ?? b.createdAt) - Date.parse(a.lastMessageAt ?? a.createdAt)
      )[0];

      if (mostRecent) selectChat(mostRecent.id);
      else await createChat(projectId);
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, loadChats, createChat, selectChat]);

  // Remember which project is open so the next launch can return to it.
  useEffect(() => {
    if (!settingsLoaded || !selectedProjectId) return;
    if (settings.lastProjectId === selectedProjectId) return;
    void updateSettings({ lastProjectId: selectedProjectId });
  }, [selectedProjectId, settingsLoaded, settings.lastProjectId, updateSettings]);

  // Restore it exactly once, and only if that project still exists — a remembered id for a project
  // since removed must not leave the app pointing at nothing.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !settingsLoaded || loading) return;
    restored.current = true;
    if (selectedProjectId) return;
    const target = settings.restoreLastProject ? settings.lastProjectId : null;
    if (target && projects.some((p) => p.id === target)) {
      selectProject(target);
      return;
    }
    // Nothing to restore: open on the deck rather than an empty chat, which is the more useful
    // question to be looking at when you do not yet know which repo you are working in.
    if (projects.length > 0) setView('deck');
  }, [
    settingsLoaded,
    loading,
    projects,
    settings.restoreLastProject,
    settings.lastProjectId,
    selectedProjectId,
    selectProject,
    setView
  ]);

  /**
   * The agent just wrote a file, so the Changes panel is out of date.
   *
   * Debounced because a run edits in bursts — five Edits in two seconds should cost one `git status`,
   * not five. The 4s ceiling is what keeps a long run from going quiet: a file appears in the panel
   * within a few seconds of the agent writing it, which is the point of having both panels open.
   */
  const bumpGit = useCallback(() => setGitRevision((n) => n + 1), []);
  const onFilesTouched = useDebouncedCallback(bumpGit, 700, 4000);

  const onRunStateChange = useCallback(
    (running: boolean) => {
      if (!selectedChatId) return;
      setRunningChatIds((current) => {
        const without = current.filter((id) => id !== selectedChatId);
        return running ? [...without, selectedChatId] : without;
      });
      // A finished run is the moment the working tree may have changed.
      if (!running) setGitRevision((n) => n + 1);
    },
    [selectedChatId]
  );

  useHotkey('k', () => setPaletteOpen(true), { inFields: true });
  useHotkey(',', () => setView('settings'), { inFields: true });
  // Esc leaves settings. No modifier, and it must work while a field has focus.
  // Esc leaves whichever whole-pane view is open. No modifier, and it must work while a field has
  // focus.
  useHotkey('Escape', () => setView('workspace'), { ctrl: false, inFields: true });
  // Ctrl+J must reach the terminal even while it has focus, which is why it fires inside fields.
  useHotkey('j', toggleTerminal, { inFields: true });
  useHotkey('d', () => toggleView('deck'), { shift: true, inFields: true });
  useHotkey('u', () => toggleView('usage'), { shift: true, inFields: true });
  useHotkey('b', toggleSidebar);
  useHotkey('g', toggleChanges, { shift: true });

  return (
    <div className="flex h-full flex-col">
      {unreachable ? (
        <div className="border-b border-danger/40 bg-danger/10 px-3 py-1.5 text-[12.5px] text-danger">
          Cannot reach the Flight Deck server. Start it with <span className="font-mono">npm run dev</span>.
        </div>
      ) : null}

      {/*
        The collapsed rail is a plain flex sibling, NOT a child of Group.
        Group lays out Panels and Separators only, and a Panel cannot be hidden with a class:
        the library writes `display` and `flex` inline, and inline styles beat classes — so a
        `hidden` panel kept its width and left a dead gap where the sidebar used to be.
      */}
      <div className="flex min-h-0 flex-1">
        {view === 'settings' ? (
          <SettingsPage
            settings={settings}
            onUpdate={(patch) => void updateSettings(patch)}
            onReset={() => void resetSettings()}
            onClose={() => setView('workspace')}
          />
        ) : (
          <>
        {sidebarCollapsed ? (
          <ProjectSidebar
            projects={projects}
            loading={loading}
            chats={chats}
            runningChatIds={runningChatIds}
            collapsed
            onAddProject={() => setAddOpen(true)}
            onRemoveProject={(id) => void remove(id)}
            onChatsChanged={() => void loadChats(selectedProjectId)}
            onCreateChat={(id) => void createChat(id)}
            onImportSession={setImportFor}
            onCollapse={toggleSidebar}
          />
        ) : null}

        <Group orientation="horizontal" className="min-w-0 flex-1">
          {sidebarCollapsed ? null : (
            <Panel id="sidebar" defaultSize="18" minSize="12" maxSize="32">
              <ProjectSidebar
                projects={projects}
                loading={loading}
                chats={chats}
                runningChatIds={runningChatIds}
                collapsed={false}
                onAddProject={() => setAddOpen(true)}
                onRemoveProject={(id) => void remove(id)}
                onChatsChanged={() => void loadChats(selectedProjectId)}
                onCreateChat={(id) => void createChat(id)}
                onImportSession={setImportFor}
                onCollapse={toggleSidebar}
              />
            </Panel>
          )}
          {sidebarCollapsed ? null : <ResizeHandle />}

          {view === 'deck' ? (
            <Panel id="deck" minSize="30">
              <DeckPage
                open
                onOpenProject={(id) => {
                  selectProject(id);
                  setView('workspace');
                }}
                onAddProject={() => setAddOpen(true)}
                onClose={() => setView('workspace')}
              />
            </Panel>
          ) : view === 'usage' ? (
            <Panel id="usage" minSize="30">
              <UsagePage
                open
                onOpenProject={(id) => {
                  selectProject(id);
                  setView('workspace');
                }}
                onOpenChat={(id, chatId) => {
                  // Project first: selecting a project clears the chat, so the order matters.
                  selectProject(id);
                  selectChat(chatId);
                  setView('workspace');
                }}
                onClose={() => setView('workspace')}
              />
            </Panel>
          ) : (
            <>
          <Panel id="chat" minSize="30">
            {/* A nested vertical group: chat above, terminal below, with a drag handle between them.
                Inside the centre column rather than across the window, so the Changes panel stays
                visible while a build runs. */}
            <Group orientation="vertical" className="h-full">
              <Panel id="conversation" minSize="30">
                <ChatPanel
                  project={project}
                  chat={chat}
                  onCreateChat={() => project && void createChat(project.id)}
                  onChatChanged={(updated) =>
                    setChats((current) => current.map((c) => (c.id === updated.id ? updated : c)))
                  }
                  onRunStateChange={onRunStateChange}
                  onFilesTouched={onFilesTouched}
                />
              </Panel>

              {terminalOpen ? (
                <>
                  <VerticalHandle />
                  <Panel id="terminal" defaultSize="34" minSize="15" maxSize="70">
                    <Suspense
                      fallback={
                        <div className="flex h-full items-center justify-center border-t border-border-default bg-(--bg-base) text-[12.5px] text-text-muted">
                          Loading terminal…
                        </div>
                      }
                    >
                      <TerminalDrawer
                        project={project}
                        shellId={settings.terminalShell}
                        fontSize={settings.terminalFontSize}
                        cursorBlink={settings.terminalCursorBlink}
                        onShellChange={(id) => void updateSettings({ terminalShell: id })}
                        onCommitted={bumpGit}
                        onClose={() => setTerminalOpen(false)}
                      />
                    </Suspense>
                  </Panel>
                </>
              ) : null}
            </Group>
          </Panel>

          {changesCollapsed ? null : (
            <>
              <ResizeHandle />
              <Panel id="changes" defaultSize="26" minSize="18" maxSize="45">
                <ChangesPanel project={project} revision={gitRevision} confirmLevel={settings.confirmLevel} />
              </Panel>
            </>
          )}
            </>
          )}
        </Group>
          </>
        )}
      </div>

      <StatusBar
        sidebarCollapsed={sidebarCollapsed}
        changesCollapsed={changesCollapsed}
        onToggleSidebar={toggleSidebar}
        onToggleChanges={toggleChanges}
      />

      <AddProjectDialog open={addOpen} onOpenChange={setAddOpen} onAdd={add} />
      <ImportSessionDialog
        project={projects.find((p) => p.id === importFor) ?? null}
        open={importFor !== null}
        onOpenChange={(next) => setImportFor(next ? importFor : null)}
        onImported={() => {
          // The imported chat belongs to the project it was imported for, which is not
          // necessarily the one currently selected.
          if (importFor === selectedProjectId) void loadChats(selectedProjectId);
          else if (importFor) selectProject(importFor);
        }}
      />
      <CommandPalette projects={projects} chats={chats} />
    </div>
  );
}

/** The horizontal drag target between two panels. Kept 1px so it reads as a divider, widened on
 *  hover so it is actually grabbable. */
function ResizeHandle() {
  return (
    <Separator className="w-px shrink-0 bg-border-subtle transition-colors duration-(--duration-fast) hover:w-[3px] hover:bg-accent-bright data-[state=drag]:bg-accent-bright" />
  );
}

/** Same idea, rotated: the divider between chat and terminal. */
function VerticalHandle() {
  return (
    <Separator className="h-px shrink-0 bg-border-default transition-colors duration-(--duration-fast) hover:h-[3px] hover:bg-accent-bright data-[state=drag]:bg-accent-bright" />
  );
}

function StatusBar({
  sidebarCollapsed,
  changesCollapsed,
  onToggleSidebar,
  onToggleChanges
}: {
  sidebarCollapsed: boolean;
  changesCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleChanges: () => void;
}) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border-subtle bg-surface-1 px-2 text-[12.5px] text-text-muted">
      <button
        onClick={onToggleSidebar}
        title="Toggle projects (Ctrl+B)"
        className="flex items-center gap-1.5 hover:text-text-primary"
      >
        <PanelLeft size={12} />
        {sidebarCollapsed ? 'Show projects' : 'Hide projects'}
      </button>
      <button
        onClick={onToggleChanges}
        title="Toggle changes (Ctrl+Shift+G)"
        className="flex items-center gap-1.5 hover:text-text-primary"
      >
        <PanelRight size={12} />
        {changesCollapsed ? 'Show changes' : 'Hide changes'}
      </button>
      <span className="ml-auto">
        <span className="font-mono">Ctrl+K</span> to jump
      </span>
    </footer>
  );
}
