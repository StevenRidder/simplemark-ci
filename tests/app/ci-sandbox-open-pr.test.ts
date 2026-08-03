import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// scripts/ci-sandbox.sh is the only path from "green on the public sandbox" to a
// canonical required status, and it talks to two remotes in an order that has to
// be exactly right. It cannot be exercised against real GitHub in the gate, so it
// runs here against stub `git` and `gh` binaries that track remote ref state:
// a push adds a ref, a delete removes it, and ls-remote reports what is actually
// there. Ordering mistakes therefore fail the way they fail in production rather
// than passing because the stub always says yes.

const script = join(process.cwd(), 'scripts', 'ci-sandbox.sh');
const BRANCH = 'claude/EXAMPLE-1-demo';
const SHA = 'a'.repeat(40);

interface Harness {
  dir: string;
  env: NodeJS.ProcessEnv;
  calls(): string[];
  refs(): string[];
}

function harness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'simplemark-ci-sandbox-'));
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  const refs = join(dir, 'refs');

  // Remote ref state, one "<remote> <ref>" per line. Seeded with the canonical
  // branch absent: open-pr is expected to create it.
  writeFileSync(refs, '');
  writeFileSync(log, '');

  spawnSync('mkdir', ['-p', bin]);

  const gitStub = `#!/usr/bin/env bash
set -uo pipefail
printf 'git %s\\n' "$*" >> ${JSON.stringify(log)}
args=("$@")
# Drop the leading "-C <path>" the script always passes.
if [ "\${args[0]:-}" = "-C" ]; then args=("\${args[@]:2}"); fi

# The script addresses the sandbox by remote NAME when pushing and by clone URL
# when reading (cmd_prove uses $CI_REMOTE_URL), so ref state has to be keyed on
# the repo, not on whichever spelling the caller happened to use.
normalize_remote() {
  case "$1" in
    *simplemark-ci*) printf 'ci' ;;
    origin|*/simplemark.git|*/simplemark) printf 'origin' ;;
    *) printf '%s' "$1" ;;
  esac
}

case "\${args[0]:-}" in
  rev-parse)
    case "\${args[1]:-}" in
      --is-inside-work-tree) echo true ;;
      *) echo ${JSON.stringify(SHA)} ;;
    esac ;;
  show-ref) exit 0 ;;
  branch) echo ${JSON.stringify(BRANCH)} ;;
  remote) echo "https://github.com/StevenRidder/simplemark-ci.git" ;;
  ls-remote)
    remote="$(normalize_remote "\${args[1]}")"; ref="\${args[2]}"
    if grep -qxF "$remote $ref" ${JSON.stringify(refs)}; then
      printf '%s\\t%s\\n' ${JSON.stringify(SHA)} "$ref"
    fi ;;
  push)
    remote=""; delete=0; refspec=""
    for a in "\${args[@]:1}"; do
      case "$a" in
        -u|--set-upstream) ;;
        --delete) delete=1 ;;
        *) if [ -z "$remote" ]; then remote="$(normalize_remote "$a")"; else refspec="$a"; fi ;;
      esac
    done
    # Accept "refs/heads/x:refs/heads/x", a bare branch, or a delete target.
    ref="\${refspec##*:}"
    case "$ref" in refs/*) ;; *) ref="refs/heads/$ref" ;; esac
    if [ "$delete" = 1 ]; then
      grep -vxF "$remote $ref" ${JSON.stringify(refs)} > ${JSON.stringify(refs)}.tmp || true
      mv ${JSON.stringify(refs)}.tmp ${JSON.stringify(refs)}
    else
      grep -qxF "$remote $ref" ${JSON.stringify(refs)} || echo "$remote $ref" >> ${JSON.stringify(refs)}
    fi ;;
  *) ;;
esac
exit 0
`;

  // One completed, successful workflow_dispatch run for the exact SHA, so the
  // wait loop resolves on its first poll and the test does not sleep. createdAt
  // must sort after the dispatch timestamp the script stamps at call time — the
  // wait loop only counts runs at or newer than the dispatch it just triggered.
  const run = JSON.stringify([{
    databaseId: 1,
    name: 'verify',
    status: 'completed',
    conclusion: 'success',
    createdAt: '2999-01-01T00:00:00Z',
    event: 'workflow_dispatch',
    headSha: SHA,
  }]);

  const ghStub = `#!/usr/bin/env bash
set -uo pipefail
printf 'gh %s\\n' "$*" >> ${JSON.stringify(log)}
case "\${1:-}" in
  repo) exit 0 ;;
  workflow) exit 0 ;;
  run) echo ${JSON.stringify(run)} ;;
  api) exit 0 ;;
  pr)
    # "pr view" must report no existing PR; "pr create" succeeds.
    [ "\${2:-}" = "view" ] && exit 1
    exit 0 ;;
esac
exit 0
`;

  writeFileSync(join(bin, 'git'), gitStub);
  writeFileSync(join(bin, 'gh'), ghStub);
  chmodSync(join(bin, 'git'), 0o755);
  chmodSync(join(bin, 'gh'), 0o755);

  return {
    dir,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      POLL_INTERVAL_SEC: '1',
      WAIT_TIMEOUT_SEC: '30',
    },
    calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
    refs: () => (existsSync(refs) ? readFileSync(refs, 'utf8').split('\n').filter(Boolean) : []),
  };
}

// The script always calls git as `git -C <root> …`, so match on the subcommand
// rather than the start of the line.
const isGitPush = (c: string) => c.startsWith('git ') && / push /.test(c);
const isStamp = (c: string) => c.startsWith('gh ') && c.includes('api') && c.includes('/statuses/');
const isSandboxDelete = (c: string) => isGitPush(c) && c.includes('--delete');
const isCanonicalPush = (c: string) => isGitPush(c) && / origin /.test(c);

describe('ci-sandbox.sh open-pr', () => {
  it('completes end to end and opens the PR', () => {
    const h = harness();
    const result = spawnSync('bash', [script, 'open-pr', BRANCH], { env: h.env, encoding: 'utf8' });

    expect(result.stderr).not.toMatch(/is not the local tested SHA/);
    expect(result.status).toBe(0);
    expect(h.calls().some((c) => c.startsWith('gh pr create'))).toBe(true);
  });

  it('stamps the canonical status before deleting the sandbox ref', () => {
    const h = harness();
    spawnSync('bash', [script, 'open-pr', BRANCH], { env: h.env, encoding: 'utf8' });
    const calls = h.calls();

    const stamp = calls.findIndex(isStamp);
    const del = calls.findIndex(isSandboxDelete);

    // The stamp must happen at all — the original bug reported "proof stamped"
    // while skipping it entirely.
    expect(stamp).toBeGreaterThanOrEqual(0);
    expect(del).toBeGreaterThanOrEqual(0);
    expect(stamp).toBeLessThan(del);
  });

  it('pushes the canonical branch before stamping, since prove asserts both remotes', () => {
    const h = harness();
    spawnSync('bash', [script, 'open-pr', BRANCH], { env: h.env, encoding: 'utf8' });
    const calls = h.calls();
    const push = calls.findIndex(isCanonicalPush);
    const stamp = calls.findIndex(isStamp);

    // Assert both were found first: `-1 < stamp` would otherwise let a matcher
    // that matches nothing pass this test.
    expect(push).toBeGreaterThanOrEqual(0);
    expect(stamp).toBeGreaterThanOrEqual(0);
    expect(push).toBeLessThan(stamp);
  });

  it('leaves no sandbox branch behind once the proof exists', () => {
    const h = harness();
    spawnSync('bash', [script, 'open-pr', BRANCH], { env: h.env, encoding: 'utf8' });

    expect(h.refs()).not.toContain(`ci refs/heads/${BRANCH}`);
    expect(h.refs()).toContain(`origin refs/heads/${BRANCH}`);
  });
});

describe('ci-sandbox.sh push', () => {
  it('keeps the sandbox ref when the canonical branch is not there to stamp', () => {
    const h = harness();
    // Plain `push` never touches the canonical remote, so nothing can be stamped.
    const result = spawnSync('bash', [script, 'push', BRANCH], { env: h.env, encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(h.calls().some(isStamp)).toBe(false);
    // Deleting here would destroy the only evidence `prove` can read later.
    expect(h.calls().some(isSandboxDelete)).toBe(false);
    expect(h.refs()).toContain(`ci refs/heads/${BRANCH}`);
    expect(result.stdout).not.toMatch(/proof stamped/);
  });
});
