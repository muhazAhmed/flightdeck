import { useCallback, useEffect, useState } from 'react';
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

  const project = projects.find((p) => p.id === selectedProjectId) ?? null;
  const chat = chats.find((c) => c.id === selectedChatId) ?? null;

  const loadChats = useCallback(async (projectId: string | null) => {
    if (!projectId) {
      setChats([]);
      return;
    }
    try {
      setChats(await chatsApi.list(projectId));
    } catch (error) {
      toast.error(messageOf(error), { description: detailOf(error) });
    }
  }, []);

  useEffect(() => {
    void loadChats(selectedProjectId);
  }, [selectedProjectId, loadChats]);

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
  useHotkey('b', toggleSidebar);
  useHotkey('g', toggleChanges, { shift: true });

  return (
    <div className="flex h-full flex-col">
      {unreachable ? (
        <div className="border-b border-danger/40 bg-danger/10 px-3 py-1.5 text-[12.5px] text-danger">
          Cannot reach the Flight Deck server. Start it with <span className="font-mono">npm run dev</span>.
        </div>
      ) : null}

      <Group orientation="horizontal" className="flex-1">
        <Panel
          id="sidebar"
          defaultSize="18"
          minSize="12"
          maxSize="32"
          className={sidebarCollapsed ? 'hidden' : undefined}
        >
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
        ) : (
          <ResizeHandle />
        )}

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
              <ChangesPanel project={project} revision={gitRevision} />
            </Panel>
          </>
        )}
      </Group>

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
