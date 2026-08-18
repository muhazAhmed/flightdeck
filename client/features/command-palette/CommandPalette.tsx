import { Command } from 'cmdk';
import { FolderGit2, MessageSquare } from 'lucide-react';
import type { Chat, Project } from '@shared/types';
import { useWorkspace } from '@/store/workspace';

interface CommandPaletteProps {
  projects: Project[];
  chats: Chat[];
}

/**
 * Ctrl+K navigation. This is the answer to the problem that started the whole project:
 * with twenty repositories, finding the right one should be two keystrokes and a few
 * letters, not a scan down a sidebar.
 */
export function CommandPalette({ projects, chats }: CommandPaletteProps) {
  const open = useWorkspace((s) => s.paletteOpen);
  const setOpen = useWorkspace((s) => s.setPaletteOpen);
  const selectProject = useWorkspace((s) => s.selectProject);
  const selectChat = useWorkspace((s) => s.selectChat);

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? 'unknown';

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Jump to a project or chat"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]"
      contentClassName="w-[min(560px,92vw)] overflow-hidden rounded-lg border border-border-default bg-surface-1 shadow-[var(--shadow-popover)]"
    >
      <Command.Input
        placeholder="Jump to a project or chat…"
        className="w-full border-b border-border-subtle bg-transparent px-4 py-3 text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      <Command.List className="max-h-80 overflow-y-auto p-1.5">
        <Command.Empty className="px-3 py-6 text-center text-[12.5px] text-text-muted">
          Nothing matches.
        </Command.Empty>

        <Command.Group heading="Projects" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[12.5px] [&_[cmdk-group-heading]]:text-text-muted">
          {projects.map((project) => (
            <Command.Item
              key={project.id}
              value={`${project.name} ${project.path}`}
              onSelect={() => {
                selectProject(project.id);
                setOpen(false);
              }}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 data-[selected=true]:bg-accent-subtle"
            >
              <FolderGit2 size={13} className="shrink-0 text-text-muted" />
              <span className="truncate">{project.name}</span>
              <span className="ml-auto truncate font-mono text-[12.5px] text-text-muted">{project.path}</span>
            </Command.Item>
          ))}
        </Command.Group>

        {chats.length > 0 ? (
          <Command.Group heading="Chats" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[12.5px] [&_[cmdk-group-heading]]:text-text-muted">
            {chats.map((chat) => (
              <Command.Item
                key={chat.id}
                value={`${chat.title} ${projectName(chat.projectId)}`}
                onSelect={() => {
                  selectProject(chat.projectId);
                  selectChat(chat.id);
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 data-[selected=true]:bg-accent-subtle"
              >
                <MessageSquare size={13} className="shrink-0 text-text-muted" />
                <span className="truncate">{chat.title}</span>
                <span className="ml-auto shrink-0 text-[12.5px] text-text-muted">{projectName(chat.projectId)}</span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
      </Command.List>
    </Command.Dialog>
  );
}
