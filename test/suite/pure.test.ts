import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

suite('Pure Module Tests', () => {
  test('git status parser should detect diverged dirty repositories', () => {
    const { getKeyProjectSyncLabel, parseGitStatusSummary } = require('../pinnedProjects/gitStatus') as any;

    const parsed = parseGitStatusSummary(
      [
        '# branch.oid abcdef',
        '# branch.head feature',
        '# branch.upstream origin/feature',
        '# branch.ab +2 -3',
        '1 .M N... 100644 100644 100644 old new src/app.ts'
      ].join('\n')
    );

    assert.strictEqual(parsed.branch, 'feature');
    assert.strictEqual(parsed.upstream, 'origin/feature');
    assert.strictEqual(parsed.syncState, 'diverged');
    assert.strictEqual(parsed.clean, false);
    assert.strictEqual(getKeyProjectSyncLabel(parsed), 'diverged +2/-3');
  });

  test('batched ssh parser should preserve multiline fields', () => {
    const { parseBatchedSshKeyProjectResults } = require('../pinnedProjects/remoteBatch') as any;

    const parsed = parseBatchedSshKeyProjectResults(
      [
        '__MYTB_BEGIN__ 0 dirty-repo',
        '__MYTB_FIELD__ repoPath',
        '/remote/dirty-repo',
        '__MYTB_END_FIELD__ repoPath',
        '__MYTB_FIELD__ remoteUrl',
        'git@example:dirty-repo.git',
        '__MYTB_END_FIELD__ remoteUrl',
        '__MYTB_FIELD__ fetchError',
        'line one',
        'line two',
        '__MYTB_END_FIELD__ fetchError',
        '__MYTB_FIELD__ error',
        '__MYTB_END_FIELD__ error',
        '__MYTB_FIELD__ status',
        '# branch.head main',
        '__MYTB_END_FIELD__ status',
        '__MYTB_END__ 0 dirty-repo'
      ].join('\n')
    );

    assert.strictEqual(parsed.get('dirty-repo')?.repoPath, '/remote/dirty-repo');
    assert.strictEqual(parsed.get('dirty-repo')?.fetchError, 'line one\nline two');
    assert.strictEqual(parsed.get('dirty-repo')?.statusOutput, '# branch.head main');
  });

  test('reverse tunnel config should reject duplicate remotes', () => {
    const { loadFileProxyConfig } = require('../reverseTunnel/config') as any;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mytoolbox-config-test-'));
    const configPath = path.join(dir, 'mytoolbox.config.json');

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ReverseTunnel: {
          sshPath: 'ssh',
          connectionReadyDelayMs: 1200,
          localHost: '127.0.0.1',
          localPort: 7897,
          remotes: [
            { remoteHost: 'host', remotePort: 22, remoteUser: 'me', remoteBindPort: 17897, identityFile: '' },
            { remoteHost: 'host', remotePort: 22, remoteUser: 'me', remoteBindPort: 17898, identityFile: '' }
          ]
        }
      }),
      'utf8'
    );

    assert.throws(() => loadFileProxyConfig(configPath), /duplicate remote/);
  });

  test('reverse tunnel config should allow empty remotes', () => {
    const { loadFileProxyConfig } = require('../reverseTunnel/config') as any;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mytoolbox-config-test-'));
    const configPath = path.join(dir, 'mytoolbox.config.json');

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ReverseTunnel: {
          sshPath: 'ssh',
          connectionReadyDelayMs: 1200,
          localHost: '127.0.0.1',
          localPort: 7897,
          remotes: []
        }
      }),
      'utf8'
    );

    const parsed = loadFileProxyConfig(configPath);
    assert.deepStrictEqual(parsed.remotes, []);
  });

  test('reverse tunnel path resolution should use workspace and expand workspace variables', () => {
    const { resolveConfiguredConfigPathWithContext, resolveConfigPathWithContext } = require('../reverseTunnel/config') as any;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mytoolbox-path-test-'));
    const extensionPath = path.join(dir, 'extension');
    const workspacePath = path.join(dir, 'workspace');
    fs.mkdirSync(path.join(extensionPath, 'resources'), { recursive: true });
    fs.mkdirSync(workspacePath, { recursive: true });
    const relativeConfigName = '.vscode/mytoolbox.config.json';
    const workspaceConfigPath = path.join(workspacePath, relativeConfigName);
    fs.mkdirSync(path.dirname(workspaceConfigPath), { recursive: true });
    fs.writeFileSync(workspaceConfigPath, '{}', 'utf8');

    const options = {
      workspaceFolder: workspacePath,
      remoteName: undefined,
      homeDir: dir,
      extensionPath
    };

    assert.strictEqual(resolveConfiguredConfigPathWithContext(relativeConfigName, options), workspaceConfigPath);
    assert.strictEqual(resolveConfigPathWithContext(relativeConfigName, options), workspaceConfigPath);
    assert.strictEqual(resolveConfiguredConfigPathWithContext('${workspaceFolder}/.vscode/mytoolbox.config.json', {
      ...options,
      remoteName: 'ssh-remote'
    }), workspaceConfigPath);
    assert.strictEqual(resolveConfigPathWithContext(relativeConfigName, {
      ...options,
      remoteName: 'ssh-remote'
    }), workspaceConfigPath);
  });
});
