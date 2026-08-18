import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronRight, FolderGit2, MessageSquarePlus, Plus, Trash2 } from 'lucide-react';
import type { Chat, Project } from '@shared/types';
import { Button } from '@/shared/ui/Button';
import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/lib/cn';
import { relativeTime, shortPath } from '@/lib/format';
import { detailOf, messageOf } from '@/lib/http';
import { useWorkspace } from '@/store/workspace';
import { chatsApi } from '@/features/chat/api';

interface ProjectSidebarProps {
  projects: Project[];
  loading: boolean;
  chats: Chat[];
  runningChatIds: string[];
  collapsed: boolean;
  onAddProject: () => void;
  onRemoveProject: (id: string) => void;
  onChatsChanged: () => void;
  onCreateChat: (projectId: string) => void;
}

export function ProjectSidebar({
  projects,
  loading,
  chats,
  runningChatIds,
  collapsed,
  onAddProject,
  onRemoveProject,
  onChatsChanged,
  onCreateChat
}: ProjectSidebarProps) {
  const selectedProjectId = useWorkspace((s) => s.selectedProjectId);
  const selectedChatId = useWorkspace((s) => s.selectedChatId);
  const selectProject = useWorkspace((s) => s.selectProject);
  const selectChat = useWorkspace((s) => s.selectChat);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Opening a project should reveal its chats without a second click.
  useEffect(() => {
    if (!selectedProjectId) return;
    setExpanded((current) => (current.has(selectedProjectId) ? current : new Set(current).add(selectedProjectId)));
  }, [selectedProjectId]);

  if (collapsed) {
    return (
      <nav className="flex h-full w-12 flex-col items-center gap-1 border-r border-border-subtle bg-surface-1 py-2">
        {projects.map((project) => (
          <button
            key={project.id}
            title={project.name}
            onClick={() => selectProject(project.id)}
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded font-medium uppercase',
              'transition-colors duration-[var(--duration-fast)]',
              project.id === selectedProjectId
                ? 'bg-accent-subtle text-accent-bright'
                : 'text-text-secondary hover:bg-surface-2'
            )}
          >
            {project.name.slice(0, 2)}
          </button>
        ))}
        <button
          title="Add project"
          onClick={onAddProject}
          className="mt-1 flex size-8 items-center justify-center rounded text-text-muted hover:bg-surface-2 hover:text-text-primary"
        >
          <Plus size={15} />
        </button>
      </nav>
    );
  }

  return (
    <nav className="flex h-full flex-col border-r border-border-subtle bg-surface-1">
      <header className="flex items-center justify-between px-3 py-2">
        <span className="text-[12.5px] font-medium tracking-wide text-text-muted uppercase">Projects</span>
        <span className="tabular text-[12.5px] text-text-muted">{projects.length}</span>
      </header>

      <div className="flex-1 overflow-y-auto px-1.5">
        {loading ? (
          <div className="flex flex-col gap-1.5 px-1.5">
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
          </div>
        ) : projects.length === 0 ? (
          <p className="px-2 py-3 text-[12.5px] leading-4 text-text-muted">
            No projects yet. Add any folder that is a git repository.
          </p>
        ) : (
          projects.map((project) => {
            const projectChats = chats.filter((c) => c.projectId === project.id);
            const isOpen = expanded.has(project.id);
            const isSelected = project.id === selectedProjectId;

            return (
              <div key={project.id} className="mb-0.5">
                <div
                  className={cn(
                    'group flex items-center gap-1 rounded px-1.5 py-1',
                    'transition-colors duration-[var(--duration-fast)]',
                    isSelected ? 'bg-accent-subtle' : 'hover:bg-surface-2'
                  )}
                >
                  <button
                    onClick={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(project.id)) next.delete(project.id);
                        else next.add(project.id);
                        return next;
                      })
                    }
                    className="shrink-0 text-text-muted"
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                  >
                    <ChevronRight
                      size={13}
                      className={cn('transition-transform duration-[var(--duration-fast)]', isOpen && 'rotate-90')}
                    />
                  </button>

                  <button onClick={() => selectProject(project.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                    <FolderGit2 size={13} className={cn('shrink-0', isSelected ? 'text-accent-bright' : 'text-text-muted')} />
                    <span className="truncate">{project.name}</span>
                  </button>

                  <button
                    title={`New chat in ${project.name}`}
                    onClick={() => onCreateChat(project.id)}
                    className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-text-primary"
                  >
                    <MessageSquarePlus size={13} />
                  </button>
                  <button
                    title={`Remove ${project.name} from the list`}
                    onClick={() => onRemoveProject(project.id)}
                    className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {isOpen ? (
                  <div className="ml-5 border-l border-border-subtle pl-1.5">
                    <p className="truncate px-1.5 py-0.5 font-mono text-[12.5px] text-text-muted">
                      {shortPath(project.path)}
                    </p>
                    {projectChats.length === 0 ? (
                      <button
                        onClick={() => onCreateChat(project.id)}
                        className="px-1.5 py-1 text-[12.5px] text-text-muted hover:text-accent-bright"
                      >
                        Start a chat
                      </button>
                    ) : (
                      projectChats.map((chat) => (
                        <ChatRow
                          key={chat.id}
                          chat={chat}
                          selected={chat.id === selectedChatId}
                          running={runningChatIds.includes(chat.id)}
                          onSelect={() => {
                            if (project.id !== selectedProjectId) selectProject(project.id);
                            selectChat(chat.id);
                          }}
                          onDeleted={onChatsChanged}
                        />
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <footer className="border-t border-border-subtle p-2">
        <Button variant="secondary" size="sm" className="w-full" onClick={onAddProject}>
          <Plus size={13} /> Add project
        </Button>
      </footer>
    </nav>
  );
}

function ChatRow({
  chat,
  selected,
  running,
  onSelect,
  onDeleted
}: {
  chat: Chat;
  selected: boolean;
  running: boolean;
  onSelect: () => void;
  onDeleted: () => void;
}) {
  async function remove() {
    try {
      await chatsApi.remove(chat.id);
      onDeleted();
    } catch (error) {
      toast.error(messageOf(error), { description: detailOf(error) });
    }
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 rounded px-1.5 py-1',
        selected ? 'bg-accent-subtle text-text-primary' : 'text-text-secondary hover:bg-surface-2'
      )}
    >
      {running ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent-bright" /> : null}
      <button onClick={onSelect} className="min-w-0 flex-1 truncate text-left">
        {chat.title}
      </button>
      <span className="tabular shrink-0 text-[12.5px] text-text-muted">{relativeTime(chat.lastMessageAt)}</span>
      <button
        title="Delete chat"
        onClick={() => void remove()}
        className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
