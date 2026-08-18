/**
 * The single JSON file that holds projects, chats, and layout.
 *
 * Durability rules, in order of how much they matter:
 *   1. Never write a truncated file — writes go to a temp file and are renamed into
 *      place, so a crash mid-write leaves the previous file intact.
 *   2. Never lose the user's project list to a parse error — a corrupt file is moved
 *      aside as `state.corrupt-<n>.json` rather than overwritten.
 *
 * No message history lives here; see DECISIONS.md — Claude Code owns transcripts.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppState, Chat, Project } from '@shared/types';
import { stateDir, statePath } from './platform.js';

const EMPTY: AppState = {
  version: 1,
  lastBrowsedDir: null,
  projects: [],
  chats: [],
  identities: [],
  layout: {}
};

function isState(v: unknown): v is AppState {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Partial<AppState>;
  return Array.isArray(s.projects) && Array.isArray(s.chats);
}

let cache: AppState | null = null;

export function read(): AppState {
  if (cache) return cache;
  const p = statePath();
  if (!existsSync(p)) {
    cache = { ...EMPTY };
    return cache;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(p, 'utf8'));
    if (!isState(parsed)) throw new Error('not a state file');
    // Tolerate a file written by an older version missing newer fields.
    cache = { ...EMPTY, ...parsed };
    return cache;
  } catch {
    // Keep the unreadable file — losing a project list silently is unacceptable.
    let n = 1;
    while (existsSync(join(stateDir(), `state.corrupt-${n}.json`))) n++;
    try {
      renameSync(p, join(stateDir(), `state.corrupt-${n}.json`));
    } catch {
      /* nothing more we can do; fall through to an empty state */
    }
    cache = { ...EMPTY };
    return cache;
  }
}

export function write(next: AppState): void {
  mkdirSync(stateDir(), { recursive: true });
  const p = statePath();
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  renameSync(tmp, p);
  cache = next;
}

/** Read-modify-write in one step, so no caller can forget to persist. */
export function update<T>(fn: (state: AppState) => T): T {
  const state = read();
  const next: AppState = {
    ...state,
    projects: [...state.projects],
    chats: [...state.chats],
    identities: [...(state.identities ?? [])],
    layout: { ...state.layout }
  };
  const result = fn(next);
  write(next);
  return result;
}

export function findProject(id: string): Project | undefined {
  return read().projects.find((p) => p.id === id);
}

export function findChat(id: string): Chat | undefined {
  return read().chats.find((c) => c.id === id);
}

/** Only for tests — drops the in-process cache so a fresh read hits disk. */
export function resetCache(): void {
  cache = null;
}
