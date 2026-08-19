import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronRight,
  ChevronsLeft,
  Download,
  Folder,
  MessageSquarePlus,
  Plus,
  Search,
  Settings,
  Coins,
  LayoutGrid,
  SquareTerminal,
  Trash2
} from 'lucide-react';
import type { Chat, Project, UserInfo } from '@shared/types';
import { ConfirmDialog, type ConfirmRequest } from '@/shared/ui/ConfirmDialog';
import { IconButton } from '@/shared/ui/IconButton';
import { Skeleton } from '@/shared/ui/Skeleton';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { detailOf, messageOf } from '@/lib/http';
import { useWorkspace } from '@/store/workspace';
import { chatsApi, userApi } from '@/features/chat/api';

interface ProjectSidebarProps {
  projects: Project[];
  loading: boolean;
  chats: Chat[];
  runningChatIds: string[];
  collapsed: boolean;
  onCollapse: () => void;
  onAddProject: () => void;
  onRemoveProject: (id: string) => void;
  onChatsChanged: () => void;
  onCreateChat: (projectId: string) => void;
  onImportSession: (projectId: string) => void;
}

export function ProjectSidebar({
  projects,
  loading,
  chats,
  runningChatIds,
  collapsed,
  onCollapse,
  onAddProject,
  onRemoveProject,
  onChatsChanged,
  onCreateChat,
  onImportSession
}: ProjectSidebarProps) {
  const selectedProjectId = useWorkspace((s) => s.selectedProjectId);
  const selectedChatId = useWorkspace((s) => s.selectedChatId);
  const selectProject = useWorkspace((s) => s.selectProject);
  const selectChat = useWorkspace((s) => s.selectChat);
  const setPaletteOpen = useWorkspace((s) => s.setPaletteOpen);
  const terminalOpen = useWorkspace((s) => s.terminalOpen);
  const toggleTerminal = useWorkspace((s) => s.toggleTerminal);
  const view = useWorkspace((s) => s.view);
  const toggleView = useWorkspace((s) => s.toggleView);
  const setView = useWorkspace((s) => s.setView);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Raised by a chat row, rendered once at the bottom of this component: a dialog per row would mount one
  // per chat, and the row unmounts the moment the chat is gone.
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [query, setQuery] = useState('');

  // Opening a project should reveal its chats without a second click.
  useEffect(() => {
    if (!selectedProjectId) return;
    setExpanded((current) => (current.has(selectedProjectId) ? current : new Set(current).add(selectedProjectId)));
  }, [selectedProjectId]);

  // Matches name or path: with a dozen repos, "realty" and "web/Com8" are both things people
  // reach for.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle)
    );
  }, [projects, query]);

  if (collapsed) {
    return (
      <nav className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-border-subtle bg-surface-1 py-2">
        <button
          title="Expand sidebar (Ctrl+B)"
          onClick={onCollapse}
          className="mb-1 flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-surface-2"
        >
          <img src="/logo-64.png" alt="Flight Deck" width={22} height={22} className="size-[22px] rounded" />
        </button>
        {projects.map((project) => {
          const running = chats.some((c) => c.projectId === project.id && runningChatIds.includes(c.id));
          return (
            <button
              key={project.id}
              title={project.name}
              onClick={() => selectProject(project.id)}
              className={cn(
                'relative flex size-9 shrink-0 items-center justify-center rounded-md font-medium uppercase',
                'transition-colors duration-(--duration-fast)',
                project.id === selectedProjectId
                  ? 'bg-accent-subtle text-accent-bright'
                  : 'text-text-secondary hover:bg-surface-2'
              )}
            >
              {project.name.slice(0, 2)}
              {running ? (
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-accent-bright" />
              ) : null}
            </button>
          );
        })}
        <IconButton label="Add project" className="mt-1 size-9" icon={<Plus size={16} />} onClick={onAddProject} />
        <IconButton
          label="Deck — every project at once (Ctrl+Shift+D)"
          className={cn('mt-auto size-9', view === 'deck' && 'bg-accent-subtle text-accent-bright')}
          icon={<LayoutGrid size={16} />}
          onClick={() => toggleView('deck')}
        />
        <IconButton
          label="Usage — cost and quota per project (Ctrl+Shift+U)"
          className={cn('size-9', view === 'usage' && 'bg-accent-subtle text-accent-bright')}
          icon={<Coins size={16} />}
          onClick={() => toggleView('usage')}
        />
        <IconButton
          label="Terminal (Ctrl+J)"
          className={cn('size-9', terminalOpen && 'bg-accent-subtle text-accent-bright')}
          icon={<SquareTerminal size={16} />}
          onClick={toggleTerminal}
        />
        <IconButton
          label="Settings (Ctrl+,)"
          className="size-9"
          icon={<Settings size={16} />}
          onClick={() => setView('settings')}
        />
      </nav>
    );
  }

  return (
    <nav className="flex h-full flex-col bg-surface-1">
      <header className="flex items-center gap-2 px-3 py-3">
        {/* The mark carries its own dark haze, so it sits on a plain rounded tile rather than an accent
            fill — an accent square behind it would fight the gradient. Served from public/, not bundled. */}
        <img
          src="/logo-64.png"
          alt=""
          width={28}
          height={28}
          className="size-7 shrink-0 rounded-md"
        />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">Flight Deck</span>
        <IconButton label="Collapse sidebar (Ctrl+B)" icon={<ChevronsLeft size={15} />} onClick={onCollapse} />
      </header>

      <div className="px-3 pb-3">
        <div className="flex items-center gap-2 rounded-md border border-border-default bg-surface-2 px-2 focus-within:border-accent">
          <Search size={13} className="shrink-0 text-text-muted" />
          <input
            value={query}
            placeholder="Search projects…"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-text-muted focus:outline-none"
          />
          <button
            onClick={() => setPaletteOpen(true)}
            title="Open the command palette"
            className="shrink-0 rounded border border-border-subtle px-1 font-mono text-[11px] text-text-muted hover:text-text-primary"
          >
            Ctrl K
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-3 pb-1">
        <span className="text-[12px] font-medium tracking-wide text-text-muted uppercase">Projects</span>
        <IconButton label="Add project" icon={<Plus size={14} />} onClick={onAddProject} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="flex flex-col gap-2 px-1">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        ) : projects.length === 0 ? (
          <p className="px-2 py-3 text-[13px] leading-5 text-text-muted">
            No projects yet. Add any folder that is a git repository.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-2 py-3 text-[13px] text-text-muted">Nothing matches “{query}”.</p>
        ) : (
          visible.map((project) => {
            const projectChats = chats.filter((c) => c.projectId === project.id);
            const isOpen = expanded.has(project.id);
            const isSelected = project.id === selectedProjectId;
            const running = projectChats.some((c) => runningChatIds.includes(c.id));

            return (
              <div key={project.id} className="mb-0.5">
                <div
                  className={cn(
                    'group flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5',
                    'transition-colors duration-(--duration-fast)',
                    isSelected
                      ? 'border-accent-bright bg-accent-subtle text-text-primary'
                      : 'border-transparent hover:bg-surface-2'
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
                    aria-label={isOpen ? `Collapse ${project.name}` : `Expand ${project.name}`}
                    className="shrink-0 text-text-muted hover:text-text-primary"
                  >
                    <ChevronRight
                      size={13}
                      className={cn('transition-transform duration-(--duration-fast)', isOpen && 'rotate-90')}
                    />
                  </button>

                  {/* Two lines: the name you think in, and the path that disambiguates two
                      repos with the same name in different parents. */}
                  <button
                    onClick={() => selectProject(project.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <Folder size={14} className={cn('shrink-0', isSelected ? 'text-accent-bright' : 'text-text-muted')} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13.5px] font-medium">{project.name}</span>
                        {running ? <span className="size-1.5 shrink-0 rounded-full bg-accent-bright" /> : null}
                      </span>
                      <span className="block truncate font-mono text-[11.5px] text-text-muted">{project.path}</span>
                    </span>
                  </button>

                  <span className="flex shrink-0 items-center">
                    <IconButton
                      label={`New chat in ${project.name}`}
                      icon={<MessageSquarePlus size={13} />}
                      revealOnGroupHover
                      onClick={() => onCreateChat(project.id)}
                    />
                    <IconButton
                      label={`Import an existing session for ${project.name}`}
                      icon={<Download size={13} />}
                      tone="accent"
                      revealOnGroupHover
                      onClick={() => onImportSession(project.id)}
                    />
                    <IconButton
                      label={`Remove ${project.name} from the list`}
                      icon={<Trash2 size={13} />}
                      tone="danger"
                      revealOnGroupHover
                      onClick={() => onRemoveProject(project.id)}
                    />
                  </span>
                </div>

                {isOpen ? (
                  <div className="mt-0.5 ml-6 border-l border-border-subtle pl-2">
                    {projectChats.length === 0 ? (
                      <button
                        onClick={() => onCreateChat(project.id)}
                        className="px-2 py-1 text-[12.5px] text-text-muted hover:text-accent-bright"
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
                          subChats={chats.filter((c) => c.parentChatId === chat.id).length}
                          onDeleted={onChatsChanged}
                          onConfirm={setConfirm}
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

      {/* The deck is the way back out to everything, so it sits with the other constant tools rather
          than behind a menu. */}
      <button
        onClick={() => toggleView('deck')}
        title="Deck — every project at once (Ctrl+Shift+D)"
        className={cn(
          'mx-2 mb-1 flex items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13.5px]',
          'transition-colors duration-(--duration-fast)',
          view === 'deck'
            ? 'bg-accent-subtle text-text-primary'
            : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
        )}
      >
        <LayoutGrid
          size={15}
          className={cn('shrink-0', view === 'deck' ? 'text-accent-bright' : 'text-text-muted')}
        />
        <span className="min-w-0 flex-1 truncate">Deck</span>
        <span className="shrink-0 rounded border border-border-subtle px-1 font-mono text-[11px] text-text-muted">
          Ctrl ⇧ D
        </span>
      </button>

      <button
        onClick={() => toggleView('usage')}
        title="Usage — cost and quota per project (Ctrl+Shift+U)"
        className={cn(
          'mx-2 mb-1 flex items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13.5px]',
          'transition-colors duration-(--duration-fast)',
          view === 'usage'
            ? 'bg-accent-subtle text-text-primary'
            : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
        )}
      >
        <Coins size={15} className={cn('shrink-0', view === 'usage' ? 'text-accent-bright' : 'text-text-muted')} />
        <span className="min-w-0 flex-1 truncate">Usage</span>
        <span className="shrink-0 rounded border border-border-subtle px-1 font-mono text-[11px] text-text-muted">
          Ctrl ⇧ U
        </span>
      </button>

      {/* Above the profile: a tool you reach for constantly should not be buried in settings. */}
      <button
        onClick={toggleTerminal}
        title="Terminal (Ctrl+J)"
        className={cn(
          'mx-2 mb-1 flex items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13.5px]',
          'transition-colors duration-(--duration-fast)',
          terminalOpen
            ? 'bg-accent-subtle text-text-primary'
            : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
        )}
      >
        <SquareTerminal
          size={15}
          className={cn('shrink-0', terminalOpen ? 'text-accent-bright' : 'text-text-muted')}
        />
        <span className="min-w-0 flex-1 truncate">Terminal</span>
        <span className="shrink-0 rounded border border-border-subtle px-1 font-mono text-[11px] text-text-muted">
          Ctrl J
        </span>
      </button>

      <SidebarFooter onOpenSettings={() => setView('settings')} />

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </nav>
  );
}

function ChatRow({
  chat,
  selected,
  running,
  subChats,
  onSelect,
  onDeleted,
  onConfirm
}: {
  chat: Chat;
  selected: boolean;
  running: boolean;
  /** Sub-chats that would go with it — the server deletes children in the same call. */
  subChats: number;
  onSelect: () => void;
  onDeleted: () => void;
  onConfirm: (request: ConfirmRequest) => void;
}) {
  async function remove() {
    try {
      await chatsApi.remove(chat.id);
      onDeleted();
    } catch (error) {
      toast.error(messageOf(error), { description: detailOf(error) });
    }
  }

  /**
   * Deleting a chat asks first.
   *
   * Not because it destroys anything on disk — the CLI owns the transcript and keeps it, so the
   * conversation can be imported back — but because the trash icon sits one row from the chat you are
   * reading, revealed on hover, and a misclick used to be instant and silent. The dialog also names the two
   * consequences that are not obvious: a running agent is stopped, and sub-chats go with the parent.
   */
  function confirmDelete() {
    const consequences = [
      running ? 'The agent running in it will be stopped.' : null,
      subChats > 0 ? `${subChats} sub-chat${subChats === 1 ? '' : 's'} will be deleted with it.` : null,
      "Claude Code keeps the transcript, so it can be imported back with the project's Import button."
    ].filter(Boolean);

    onConfirm({
      title: `Delete "${chat.title}"?`,
      description: consequences.join(' '),
      files: [chat.title],
      confirmLabel: 'Delete chat',
      tone: 'danger',
      onConfirm: () => void remove()
    });
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1',
        selected ? 'bg-accent-subtle text-text-primary' : 'text-text-secondary hover:bg-surface-2'
      )}
    >
      {running ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent-bright" /> : null}
      <button onClick={onSelect} className="min-w-0 flex-1 truncate text-left text-[13px]">
        {chat.title}
      </button>
      <span className="tabular shrink-0 text-[11.5px] text-text-muted">{relativeTime(chat.lastMessageAt)}</span>
      <IconButton
        label={`Delete ${chat.title}`}
        icon={<Trash2 size={12} />}
        tone="danger"
        revealOnGroupHover
        onClick={confirmDelete}
      />
    </div>
  );
}

/**
 * Who is using the app, from global git config, plus the entry point for settings.
 *
 * The settings button is deliberately inert for now: a visible, disabled affordance is honest
 * about what exists, where a button that opens an empty page is not.
 */
/**
 * Who is using the app, and the way into settings.
 *
 * The whole row is the button, not just the gear: a 28px icon in the corner of a 44px row is a
 * needlessly small target for the most-used control down here. A gear still shows on the right so
 * the row's purpose is obvious, but it is decoration inside the button rather than a nested one —
 * a button inside a button is invalid markup and swallows the outer click.
 */
function SidebarFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    void userApi
      .get()
      .then(setUser)
      .catch(() => setUser({ name: null, email: null }));
  }, []);

  const initials = (user?.name ?? '?')
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <footer className="border-t border-border-subtle p-2">
      <button
        onClick={onOpenSettings}
        title="Settings (Ctrl+,)"
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left',
          'transition-colors duration-(--duration-fast) hover:bg-surface-2'
        )}
      >
        {/* Accent fill with white text: the same treatment as a count badge, so an avatar reads as
            an identity rather than a faint circle. */}
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-[14px] font-semibold text-(--accent-fg)">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium">{user?.name ?? 'No git identity'}</span>
          <span className="block truncate text-[12px] text-text-muted">
            {user?.email ?? 'set user.email in git'}
          </span>
        </span>
        <Settings
          size={15}
          className="shrink-0 text-text-muted transition-colors duration-(--duration-fast) group-hover:text-text-primary"
        />
      </button>
    </footer>
  );
}

