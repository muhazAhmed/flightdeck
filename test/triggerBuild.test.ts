import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The build trigger, and the fetch that follows a checkout.
 *
 * Both touch a remote, so the assertions here are about what can and cannot be sent — the behaviour
 * itself is verified against a scratch repository with a real remote, because a mocked git proves
 * nothing about git.
 */
const remote = readFileSync('server/routes/remote.ts', 'utf8');
const drawer = readFileSync('client/features/terminal/TerminalDrawer.tsx', 'utf8');
const branchMenu = readFileSync('client/features/changes/BranchMenu.tsx', 'utf8');
const trigger = readFileSync('client/features/terminal/useBuildTrigger.ts', 'utf8');

test('a staged index refuses the trigger', () => {
  // `--allow-empty` does not mean "commit nothing": it commits whatever is in the index. Without this
  // guard the button would quietly ship staged work under the message "trigger build".
  assert.match(remote, /status\.staged\.length > 0/);
  assert.match(remote, /'GIT_STAGED'/);
});

test('the refusal names the staged files rather than counting them', () => {
  assert.match(remote, /status\.staged\.map\(\(file\) => file\.path\)/);
});

test('the empty commit is argv, never a command string', () => {
  // Rule 8: a concatenated string would break on the first message containing a quote, and differs
  // per shell.
  assert.match(remote, /\['commit', '--allow-empty', '-m', TRIGGER_MESSAGE\]/);
});

test('a failed push after a successful commit says the commit exists', () => {
  // Reporting only "could not push" leaves the user unsure whether anything happened — and pressing
  // the button again stacks empty commits.
  assert.match(remote, /was created, but the push failed/);
  assert.match(remote, /git reset --hard HEAD~1/);
});

test('there is exactly one push implementation, and it cannot force', () => {
  assert.equal((remote.match(/'push'/g) ?? []).length, 2, 'push argv should be built in one place');
  for (const flag of ['--force', '--force-with-lease', '-f', '--all']) {
    assert.ok(!remote.includes(`'${flag}'`), `${flag} must not appear in a push path`);
  }
});

test('the trigger runs server-side, not by typing into the shell', () => {
  // `git commit ... && git push` is invalid in Windows PowerShell 5.1, and typed input goes to
  // whatever the shell is currently running — press it during a build and the text lands there.
  assert.ok(!drawer.includes('git commit --allow-empty -m "trigger build"\\r'));
  assert.ok(!/type: 'input'/.test(drawer), 'the drawer must not send the commands as keystrokes');
  assert.match(trigger, /gitApi\.triggerBuild/);
});

test('the trigger always confirms, and the dialog shows the commands verbatim', () => {
  // Pushing is outward-facing: it starts a pipeline other people may be watching.
  assert.match(drawer, /files: \['git commit --allow-empty -m "trigger build"', 'git push'\]/);
  assert.match(drawer, /confirmLabel: 'Commit and push'/);
});

test('a checkout fetches afterwards, not as part of the switch', () => {
  // The switch is already reported when the fetch starts, so an unreachable remote delays a number
  // rather than the branch change.
  assert.match(branchMenu, /await fetchInBackground\(\)/);
  const checkout = branchMenu.slice(branchMenu.indexOf('async function checkout'));
  const body = checkout.slice(0, checkout.indexOf('async function create'));
  assert.ok(
    body.indexOf('toast.success') < body.indexOf('fetchInBackground'),
    'the switch must be reported before the fetch begins'
  );
});

test('a failed background fetch is a warning, because the switch worked', () => {
  assert.match(branchMenu, /toast\.warning\('Switched, but could not fetch'/);
});

test('the fetch spinner is separate from the busy state', () => {
  // Sharing `busy` would disable the branch menu for as long as a slow network takes.
  assert.match(branchMenu, /const \[fetching, setFetching\] = useState\(false\)/);
  assert.match(branchMenu, /disabled=\{busy\}/);
});
