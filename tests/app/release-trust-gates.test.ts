import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts', 'verify-release-trust.mjs');
const sha = 'a'.repeat(40);
const digest = 'b'.repeat(64);

function evidence(target: string) {
  const directory = mkdtempSync(join(tmpdir(), 'simplemark-release-trust-'));
  const path = join(directory, `${target}-smoke.json`);
  writeFileSync(path, JSON.stringify({
    schema: 'simplemark.platform-smoke.v1',
    target,
    commit: sha,
    artifact: {
      name: target === 'macos' ? 'SimpleMark.dmg' : target === 'windows' ? 'SimpleMark.msi' : 'SimpleMark.AppImage',
      sha256: digest,
    },
    checks: {
      install: true,
      open: true,
      openApprovedMarkdown: true,
      editSaveReopen: true,
      externalChangeHandled: true,
    },
    trust: target === 'macos'
      ? { codeSigned: true, notarized: true, stapled: true }
      : target === 'windows'
        ? { codeSigned: true, signatureVerified: true }
        : {},
  }));
  return path;
}

function run(target: string, environment: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [script, '--target', target, '--mode', 'public-release', '--evidence', evidence(target)], {
    encoding: 'utf8',
    env: { ...process.env, APPLE_API_ISSUER: '', APPLE_API_KEY: '', APPLE_API_KEY_P8: '', ...environment },
  });
}

describe('release trust gates', () => {
  it('allows Linux only with complete target smoke evidence', () => {
    const result = run('linux');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('linux public-release gate passed');
  });

  it('rejects a macOS public release when notarization credentials are absent', () => {
    const result = run('macos', {
      APPLE_CERTIFICATE: '', APPLE_CERTIFICATE_PASSWORD: '', APPLE_SIGNING_IDENTITY: '',
      APPLE_ID: '', APPLE_PASSWORD: '', APPLE_TEAM_ID: '', KEYCHAIN_PASSWORD: '',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('required signing environment is absent');
  });

  it('rejects a Windows public release when signing material is absent', () => {
    const result = run('windows', {
      SIMPLEMARK_WINDOWS_CERTIFICATE: '', SIMPLEMARK_WINDOWS_CERTIFICATE_PASSWORD: '',
      SIMPLEMARK_WINDOWS_TIMESTAMP_URL: '',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('required signing environment is absent');
  });

  it('accepts complete App Store Connect API notarization credentials without an Apple ID password', () => {
    const result = run('macos', {
      APPLE_CERTIFICATE: 'present', APPLE_CERTIFICATE_PASSWORD: 'present',
      APPLE_SIGNING_IDENTITY: 'present', APPLE_TEAM_ID: 'present', KEYCHAIN_PASSWORD: 'present',
      APPLE_API_ISSUER: 'present', APPLE_API_KEY: 'present', APPLE_API_KEY_P8: 'present',
      APPLE_ID: '', APPLE_PASSWORD: '',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('macos public-release gate passed');
  });

  it('rejects a partial API notarization credential set', () => {
    const result = run('macos', {
      APPLE_CERTIFICATE: 'present', APPLE_CERTIFICATE_PASSWORD: 'present',
      APPLE_SIGNING_IDENTITY: 'present', APPLE_TEAM_ID: 'present', KEYCHAIN_PASSWORD: 'present',
      APPLE_API_ISSUER: 'present', APPLE_API_KEY: 'present', APPLE_API_KEY_P8: '',
      APPLE_ID: '', APPLE_PASSWORD: '',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('APPLE_API_KEY_P8');
  });

  it('still accepts a complete Apple ID pair when an unused API credential is partial', () => {
    const result = run('macos', {
      APPLE_CERTIFICATE: 'present', APPLE_CERTIFICATE_PASSWORD: 'present',
      APPLE_SIGNING_IDENTITY: 'present', APPLE_TEAM_ID: 'present', KEYCHAIN_PASSWORD: 'present',
      APPLE_ID: 'present', APPLE_PASSWORD: 'present', APPLE_API_KEY: 'unused',
    });
    expect(result.status).toBe(0);
  });

  it('rejects macOS evidence that claims a signature but not notarization and stapling', () => {
    const path = evidence('macos');
    const body = JSON.parse(readFileSync(path, 'utf8'));
    body.trust = { codeSigned: true, notarized: false, stapled: false };
    writeFileSync(path, JSON.stringify(body));
    const result = spawnSync(process.execPath, [script, '--target', 'macos', '--mode', 'public-release', '--evidence', path], {
      encoding: 'utf8',
      env: {
        ...process.env,
        APPLE_CERTIFICATE: 'present', APPLE_CERTIFICATE_PASSWORD: 'present',
        APPLE_SIGNING_IDENTITY: 'present', APPLE_ID: 'present', APPLE_PASSWORD: 'present',
        APPLE_TEAM_ID: 'present', KEYCHAIN_PASSWORD: 'present',
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('platform trust evidence is incomplete: notarized, stapled');
  });
});
