import { useEffect, useState } from 'react';
import { Plus, RotateCcw, ShieldCheck, Trash2, UserRound, Workflow } from 'lucide-react';
import { MODEL_OPTIONS, type Settings } from '@shared/types';
import {
  DEFAULT_LEAD_PROMPT,
  DEFAULT_ROLES,
  type AgentRole,
  type WorkflowSettings
} from '@shared/workflow';
import { Button } from '@/shared/ui/Button';
import { Card } from '../controls/Card';
import { Picker } from '../controls/Picker';
import { Toggle } from '../controls/Toggle';

interface SectionProps {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}

// These mirror workflowProblem in server/routes/settings.ts. The server stays the authority; checking here
// only keeps an invalid patch from being sent, because onUpdate is optimistic and would flash the bad value
// before reverting.
const ROLE_ID = /^[a-z][a-z0-9-]{1,30}$/;
const MAX_ROLES = 8;
const MAX_TOOLS = 40;

const FIELD =
  'w-full rounded-lg border border-border-default bg-surface-2 px-3 py-2 text-[13px] text-text-primary ' +
  'placeholder:text-text-muted focus:border-accent-bright focus:outline-none';

const MODELS = MODEL_OPTIONS.map((option) => ({ value: option.id, label: option.label, hint: option.hint }));

function leadProblem(leadPrompt: string): string | null {
  return leadPrompt.length > 8000 ? 'The lead prompt can be at most 8000 characters.' : null;
}

function rolesProblem(roles: AgentRole[]): string | null {
  if (roles.length > MAX_ROLES) return `There can be at most ${MAX_ROLES} roles.`;
  const seen = new Set<string>();
  for (const [index, role] of roles.entries()) {
    const label = role.id || `Role ${index + 1}`;
    if (!ROLE_ID.test(role.id)) {
      return `${label}: an id is 2 to 31 lowercase letters, digits or dashes, starting with a letter.`;
    }
    if (seen.has(role.id)) return `Two roles share the id "${role.id}".`;
    seen.add(role.id);
    if (!role.name.trim() || role.name.length > 60) return `${label}: a name of at most 60 characters is required.`;
    if (!role.description.trim() || role.description.length > 600) {
      return `${label}: a description of at most 600 characters is required.`;
    }
    if (!role.prompt.trim() || role.prompt.length > 6000) {
      return `${label}: a prompt of at most 6000 characters is required.`;
    }
  }
  return null;
}

function toolsProblem(rules: string[]): string | null {
  if (rules.length > MAX_TOOLS) return `There can be at most ${MAX_TOOLS} rules.`;
  const bad = rules.find((rule) => rule.length > 200 || rule.startsWith('-'));
  return bad === undefined ? null : `"${bad}" is not a usable rule: at most 200 characters, not starting with a dash.`;
}

function parseRules(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function nextRoleId(roles: AgentRole[]): string {
  const taken = new Set(roles.map((role) => role.id));
  let n = 2;
  while (taken.has(`role-${n}`)) n += 1;
  return `role-${n}`;
}

function Problem({ text }: { text: string | null }) {
  return text ? <p className="mt-2 text-[12.5px] leading-4 text-danger">{text}</p> : null;
}

function Label({ children }: { children: string }) {
  return <span className="mb-1 block text-[12.5px] font-medium text-text-secondary">{children}</span>;
}

export function WorkflowSection({ settings, onUpdate }: SectionProps) {
  // Text is edited in a local draft and committed on blur. A PATCH per keystroke would write the whole
  // workflow to disk for every character, and an optimistic update would flicker on each rejection.
  const [draft, setDraft] = useState<WorkflowSettings>(settings.workflow);
  const [toolsText, setToolsText] = useState(settings.workflow.allowedTools.join('\n'));

  // Follow the saved value: a reset, a revert after a server error, or a change from another tab.
  useEffect(() => {
    setDraft(settings.workflow);
    setToolsText(settings.workflow.allowedTools.join('\n'));
  }, [settings.workflow]);

  const problems = {
    lead: leadProblem(draft.leadPrompt),
    roles: rolesProblem(draft.roles),
    tools: toolsProblem(draft.allowedTools)
  };

  function commit(next: WorkflowSettings) {
    setDraft(next);
    if (leadProblem(next.leadPrompt) || rolesProblem(next.roles) || toolsProblem(next.allowedTools)) return;
    if (JSON.stringify(next) === JSON.stringify(settings.workflow)) return;
    onUpdate({ workflow: next });
  }

  function editRole(index: number, patch: Partial<AgentRole>): WorkflowSettings {
    return { ...draft, roles: draft.roles.map((role, i) => (i === index ? { ...role, ...patch } : role)) };
  }

  /** Typing only changes the draft; blur is what sends it. */
  function typeRole(index: number, patch: Partial<AgentRole>) {
    setDraft(editRole(index, patch));
  }

  return (
    <>
      <Card title="Lead Engineer" icon={<Workflow size={14} />}>
        <p className="mb-2 text-[12.5px] leading-4 text-text-muted">
          Appended to the lead session&apos;s instructions for every task. It sets the order of work and the
          rules the lead follows.
        </p>
        <textarea
          aria-label="Lead Engineer prompt"
          rows={14}
          value={draft.leadPrompt}
          onChange={(e) => setDraft({ ...draft, leadPrompt: e.target.value })}
          onBlur={() => commit(draft)}
          className={`${FIELD} font-mono text-[12.5px] leading-5`}
        />
        <Problem text={problems.lead} />
        <div className="mt-2">
          <Button
            size="sm"
            disabled={draft.leadPrompt === DEFAULT_LEAD_PROMPT}
            onClick={() => commit({ ...draft, leadPrompt: DEFAULT_LEAD_PROMPT })}
          >
            <RotateCcw size={12} /> Reset to default
          </Button>
        </div>
      </Card>

      <Card title="Roles" icon={<UserRound size={14} />}>
        <p className="mb-3 text-[12.5px] leading-4 text-text-muted">
          Specialists the lead can hand a part of a task to. A disabled role is not offered to the lead at all.
        </p>

        <div className="flex flex-col gap-3">
          {draft.roles.map((role, index) => (
            <div key={index} className="rounded-lg border border-border-subtle bg-surface-2/40 p-3">
              <div className="flex items-center gap-3">
                <Toggle
                  label={`${role.name || role.id} enabled`}
                  checked={role.enabled}
                  onChange={(enabled) => commit(editRole(index, { enabled }))}
                />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                  {role.name || 'Unnamed role'}
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  aria-label={`Remove ${role.name || role.id}`}
                  onClick={() => commit({ ...draft, roles: draft.roles.filter((_, i) => i !== index) })}
                >
                  <Trash2 size={12} /> Remove
                </Button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <Label>Name</Label>
                  <input
                    value={role.name}
                    maxLength={60}
                    onChange={(e) => typeRole(index, { name: e.target.value })}
                    onBlur={() => commit(draft)}
                    className={FIELD}
                  />
                </label>
                <label className="block">
                  <Label>Id</Label>
                  <input
                    value={role.id}
                    maxLength={31}
                    spellCheck={false}
                    onChange={(e) => typeRole(index, { id: e.target.value })}
                    onBlur={() => commit(draft)}
                    className={`${FIELD} font-mono`}
                  />
                </label>
              </div>

              <div className="mt-3">
                <Label>Model</Label>
                <Picker
                  label={`Model for ${role.name || role.id}`}
                  value={role.model}
                  options={MODELS}
                  onChange={(model) => commit(editRole(index, { model }))}
                />
                <p className="mt-1 text-[12.5px] leading-4 text-text-muted">
                  Default means the same model as the lead.
                </p>
              </div>

              <label className="mt-3 block">
                <Label>Description</Label>
                <textarea
                  rows={2}
                  value={role.description}
                  maxLength={600}
                  onChange={(e) => typeRole(index, { description: e.target.value })}
                  onBlur={() => commit(draft)}
                  className={FIELD}
                />
                <span className="mt-1 block text-[12.5px] leading-4 text-text-muted">
                  The lead reads this to decide when to delegate.
                </span>
              </label>

              <label className="mt-3 block">
                <Label>Prompt</Label>
                <textarea
                  rows={6}
                  value={role.prompt}
                  maxLength={6000}
                  onChange={(e) => typeRole(index, { prompt: e.target.value })}
                  onBlur={() => commit(draft)}
                  className={`${FIELD} font-mono text-[12.5px] leading-5`}
                />
              </label>
            </div>
          ))}
        </div>

        <Problem text={problems.roles} />

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={draft.roles.length >= MAX_ROLES}
            onClick={() =>
              commit({
                ...draft,
                roles: [
                  ...draft.roles,
                  {
                    id: nextRoleId(draft.roles),
                    name: 'New role',
                    description: 'Describe when the lead should hand work to this role.',
                    prompt: 'Describe how this role should work and what it should report back.',
                    model: '',
                    enabled: true
                  }
                ]
              })
            }
          >
            <Plus size={12} /> Add role
          </Button>
          <Button size="sm" onClick={() => commit({ ...draft, roles: DEFAULT_ROLES })}>
            <RotateCcw size={12} /> Reset roles to default
          </Button>
        </div>
      </Card>

      <Card title="Allowed tools" icon={<ShieldCheck size={14} />}>
        <p className="mb-2 text-[12.5px] leading-4 text-text-muted">
          One CLI permission rule per line, allowed without approval — typically browser MCP servers such as{' '}
          <span className="font-mono">mcp__plugin_playwright_playwright</span>. A headless run cannot ask, so
          anything not allowed here is denied.
        </p>
        <textarea
          aria-label="Allowed tool rules"
          rows={5}
          value={toolsText}
          spellCheck={false}
          onChange={(e) => {
            setToolsText(e.target.value);
            setDraft({ ...draft, allowedTools: parseRules(e.target.value) });
          }}
          onBlur={() => commit(draft)}
          className={`${FIELD} font-mono text-[12.5px] leading-5`}
        />
        <Problem text={problems.tools} />
      </Card>
    </>
  );
}
