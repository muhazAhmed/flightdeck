import { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { toast } from 'sonner';
import { PanelLeft, PanelRight } from 'lucide-react';
import type { Chat } from '@shared/types';
import { ChangesPanel } from '@/features/changes/ChangesPanel';
import { chatsApi } from '@/features/chat/api';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { ImportSessionDialog } from '@/features/chat/ImportSessionDialog';
import { CommandPalette } from '@/features/command-palette/CommandPalette';
import { AddProjectDialog } from '@/features/projects/AddProjectDialog';
import { ProjectSidebar } from '@/features/projects/ProjectSidebar';
import { useProjects } from '@/features/projects/useProjects';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useSettings } from '@/features/settings/useSettings';
import { useHotkey } from '@/hooks/useHotkey';
import { detailOf, messageOf } from '@/lib/http';
import { useWorkspace } from '@/store/workspace';

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
  const settingsOpen = useWorkspace((s) => s.settingsOpen);
  const setSettingsOpen = useWorkspace((s) => s.setSettingsOpen);
  const { settings, loaded: settingsLoaded, update: updateSettings, reset: resetSettings } = useSettings();

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
    if (!settings.restoreLastProject || selectedProjectId) return;
    const target = settings.lastProjectId;
    if (target && projects.some((p) => p.id === target)) selectProject(target);
  }, [settingsLoaded, loading, projects, settings.restoreLastProject, settings.lastProjectId, selectedProjectId, selectProject]);

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
  useHotkey(',', () => setSettingsOpen(true), { inFields: true });
  // Esc leaves settings. No modifier, and it must work while a field has focus.
  useHotkey('Escape', () => setSettingsOpen(false), { ctrl: false, inFields: true });
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
        {settingsOpen ? (
          <SettingsPage
            settings={settings}
            onUpdate={(patch) => void updateSettings(patch)}
            onReset={() => void resetSettings()}
            onClose={() => setSettingsOpen(false)}
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

          <Panel id="chat" minSize="30">
            <ChatPanel
              project={project}
              chat={chat}
              onCreateChat={() => project && void createChat(project.id)}
              onChatChanged={(updated) =>
                setChats((current) => current.map((c) => (c.id === updated.id ? updated : c)))
              }
              onRunStateChange={onRunStateChange}
            />
          </Panel>

          {changesCollapsed ? null : (
            <>
              <ResizeHandle />
              <Panel id="changes" defaultSize="26" minSize="18" maxSize="45">
                <ChangesPanel project={project} revision={gitRevision} confirmLevel={settings.confirmLevel} />
              </Panel>
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

/** The drag target between two panels. Kept 1px wide so it reads as a divider, and
 *  widened on hover so it is actually grabbable. */
function ResizeHandle() {
  return (
    <Separator className="w-px shrink-0 bg-border-subtle transition-colors duration-(--duration-fast) hover:w-[3px] hover:bg-accent-bright data-[state=drag]:bg-accent-bright" />
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
