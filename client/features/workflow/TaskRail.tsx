import type { ReactNode } from 'react';
import { Circle, CircleAlert, CircleCheck, CircleDot, Loader } from 'lucide-react';
import { cn } from '@/lib/cn';
import { shortPath } from '@/lib/format';
import type { Stage, TaskView } from './foldTask';

const STAGES: Stage[] = ['Understanding', 'Planning', 'Implementing', 'Testing'];

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="border-b border-border-subtle px-3 py-3 last:border-b-0">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium tracking-wide text-text-muted uppercase">
        {title}
        {count !== undefined && count > 0 ? <span className="tabular normal-case">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Nothing({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] leading-5 text-text-muted">{children}</p>;
}

/** Colour codes a command wrote for a terminal. Built from the code point so no raw escape sits in the source. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/**
 * The last non-empty line of a command's output — where a test runner puts its verdict.
 *
 * Stripped of colour codes first: seen in use, an `npm test` result rendered as `[33m2[39m`, which is the
 * verdict wrapped in the escape sequences that would have coloured it in a terminal.
 */
function lastLine(text: string | null): string {
  if (!text) return '';
  const lines = text
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? '';
}

/**
 * A path as it reads inside the project.
 *
 * Tools report absolute paths, and in a narrow rail an absolute path truncates to its least useful end — the
 * drive and the parent folders, identical on every row. Separators are normalised only for the comparison.
 */
function inProject(path: string, root: string | null): string {
  if (!root) return shortPath(path);
  const norm = (value: string) => value.replace(/\\/g, '/').toLowerCase();
  const base = norm(root).replace(/\/+$/, '');
  if (norm(path).startsWith(`${base}/`)) return path.slice(base.length + 1).replace(/\\/g, '/');
  return shortPath(path);
}

/**
 * The facts of a task, beside its transcript.
 *
 * Everything here is counted from tool calls that happened — files from the edits, checks from the commands
 * that ran and their exit, browser work from the browser tool calls. Nothing is taken from what an agent said
 * it did, which is the difference between this rail and the report: the report is the claim, this is the
 * evidence to read it against.
 */
export function TaskRail({
  view,
  running,
  projectPath,
  roleName
}: {
  view: TaskView;
  running: boolean;
  /** The project's root, so files can be shown relative to it. Null when the project has been removed. */
  projectPath: string | null;
  roleName: (role: string) => string;
}) {
  const checks = view.commands.filter((command) => command.isCheck);
  const stageIndex = STAGES.indexOf(view.stage);

  return (
    <aside className="h-full overflow-y-auto bg-surface-1">
      <Section title="Stage">
        <ol className="flex flex-col gap-1">
          {STAGES.map((stage, index) => {
            const current = running && index === stageIndex;
            const passed = index < stageIndex || (!running && index <= stageIndex);
            return (
              <li
                key={stage}
                className={cn(
                  'flex items-center gap-2 text-[13px]',
                  current ? 'text-text-primary' : passed ? 'text-text-secondary' : 'text-text-muted'
                )}
              >
                {current ? (
                  <Loader size={12} className="animate-spin text-accent-bright" />
                ) : passed ? (
                  <CircleDot size={12} className="text-accent-bright" />
                ) : (
                  <Circle size={12} />
                )}
                {stage}
              </li>
            );
          })}
        </ol>
      </Section>

      <Section title="Plan" count={view.todos.length}>
        {view.todos.length === 0 ? (
          <Nothing>The lead has not written a plan yet.</Nothing>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {view.todos.map((todo, index) => (
              <li key={index} className="flex items-start gap-2 text-[12.5px] leading-5">
                {todo.status === 'completed' ? (
                  <CircleCheck size={12} className="mt-1 shrink-0 text-success" />
                ) : todo.status === 'in_progress' ? (
                  <Loader size={12} className={cn('mt-1 shrink-0 text-accent-bright', running && 'animate-spin')} />
                ) : (
                  <Circle size={12} className="mt-1 shrink-0 text-text-muted" />
                )}
                <span className={todo.status === 'completed' ? 'text-text-muted' : 'text-text-secondary'}>
                  {todo.content}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Files modified" count={view.files.length}>
        {view.files.length === 0 ? (
          <Nothing>No file has been edited.</Nothing>
        ) : (
          <ul className="flex flex-col gap-1">
            {view.files.map((file) => (
              <li key={file.path} className="flex items-baseline gap-2" title={file.path}>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-secondary">
                  {inProject(file.path, projectPath)}
                </span>
                <span className="shrink-0 text-[11.5px] text-text-muted">{file.by.map(roleName).join(', ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Checks" count={checks.length}>
        {checks.length === 0 ? (
          <Nothing>No test, lint, type check or build has been run.</Nothing>
        ) : (
          <ul className="flex flex-col gap-2">
            {checks.map((check) => (
              <li key={check.id} className="text-[12.5px]">
                <div className="flex items-center gap-1.5">
                  {check.result === null ? (
                    <Loader size={12} className="shrink-0 animate-spin text-accent-bright" />
                  ) : check.isError ? (
                    <CircleAlert size={12} className="shrink-0 text-danger" />
                  ) : (
                    <CircleCheck size={12} className="shrink-0 text-success" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary" title={check.command}>
                    {check.command}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-text-muted">{roleName(check.by)}</span>
                </div>
                {check.result !== null && lastLine(check.result) ? (
                  <p
                    className={cn(
                      'mt-0.5 truncate pl-[18px] font-mono text-[11.5px]',
                      check.isError ? 'text-danger' : 'text-text-muted'
                    )}
                    title={check.result}
                  >
                    {lastLine(check.result)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Browser verification" count={view.browser.length}>
        {view.browser.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {view.browser.map((call) => (
              <li key={call.id} className="flex items-center gap-1.5 text-[12.5px]">
                {call.result === null ? (
                  <Loader size={12} className="shrink-0 animate-spin text-accent-bright" />
                ) : call.isError ? (
                  <CircleAlert size={12} className="shrink-0 text-danger" />
                ) : (
                  <CircleCheck size={12} className="shrink-0 text-success" />
                )}
                {/* The last segment is the action; the prefix is the server's name, repeated on every line. */}
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-secondary" title={call.name}>
                  {call.name.split('__').at(-1)}
                </span>
                <span className="shrink-0 text-[11.5px] text-text-muted">{roleName(call.by)}</span>
              </li>
            ))}
          </ul>
        ) : view.browserServers.length === 0 ? (
          <Nothing>No browser tool is configured for this project, so nothing was checked in a browser.</Nothing>
        ) : (
          <Nothing>
            Not used.{' '}
            {view.browserServers.map((server) => `${server.name.split(':').at(-1)} (${server.status})`).join(', ')}{' '}
            available.
          </Nothing>
        )}
      </Section>

      <Section title="Blockers" count={view.denials.length + view.errors.length}>
        {view.denials.length + view.errors.length === 0 ? (
          <Nothing>Nothing was denied and nothing failed.</Nothing>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.errors.map((error, index) => (
              <li key={`error-${index}`} className="text-[12.5px] leading-5">
                <p className="text-danger">{error.message}</p>
                {error.detail ? (
                  <pre className="mt-0.5 max-h-32 overflow-auto font-mono text-[11.5px] whitespace-pre-wrap text-text-muted">
                    {error.detail}
                  </pre>
                ) : null}
              </li>
            ))}
            {view.denials.map((denial, index) => (
              <li key={`denial-${index}`} className="text-[12.5px] leading-5">
                <p className="text-warn">
                  {roleName(denial.by)} was denied {denial.toolName}
                </p>
                <p className="font-mono text-[11.5px] text-text-muted">{denial.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  );
}
