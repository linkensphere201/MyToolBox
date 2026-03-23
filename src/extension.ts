import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

let sshProcess: ChildProcessWithoutNullStreams | null = null;
let externalTunnelPid: number | null = null;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let keyStatusBarItem: vscode.StatusBarItem;
let connectTimer: NodeJS.Timeout | null = null;
let stopRequested = false;
let extensionContextRef: vscode.ExtensionContext | null = null;
let sidebarViewProvider: ProxySidebarProvider | null = null;
let sidebarTreeView: vscode.TreeView<SidebarItem> | null = null;
let keyProjectsWorkspaceOverride: string | null = null;
let keyProjectsCache: KeyProjectsCache | null = null;
let keyProjectsRefreshPromise: Promise<void> | null = null;

type ProxyState = 'stopped' | 'starting' | 'connected' | 'failed';
let proxyState: ProxyState = 'stopped';

type FileProxyConfig = {
  sshPath: string;
  connectionReadyDelayMs: number;
  remoteHost: string;
  remotePort: number;
  remoteUser: string;
  remoteBindPort: number;
  localHost: string;
  localPort: number;
  identityFile: string;
};

type RuntimeProxyConfig = FileProxyConfig & {
  loadedConfigPath: string;
};

type ExistingTunnelMatch = {
  pid: number;
  commandLine: string;
};

type ResolvePathOptions = {
  workspaceFolder?: string;
  remoteName?: string;
  homeDir?: string;
  extensionPath?: string;
};

type KeyProjectsMode = 'local' | 'ssh';

type KeyProjectsConfig = {
  mode: KeyProjectsMode;
  rootDir: string;
  repoNames: string[];
  sshTarget: string;
  sshPort: number;
  gitPath: string;
  sshPath: string;
  loadedConfigPath: string;
  configExists: boolean;
  workspaceAvailable: boolean;
};

type KeyProjectStatus = {
  configuredRepoName: string;
  repoName: string;
  repoPath: string;
  branch: string;
  upstream?: string;
  syncState: 'synced' | 'ahead' | 'behind' | 'diverged' | 'no-upstream' | 'unknown';
  aheadCount: number;
  behindCount: number;
  shortStatus: string;
  fullStatus?: string;
  clean: boolean;
  available: boolean;
  error?: string;
  fetchError?: string;
};

type KeyProjectsCache = {
  signature: string;
  statuses: KeyProjectStatus[];
};

type SidebarGroupId = 'reverseTunnel' | 'keyProjects';

type SidebarTestItem = {
  kind: string;
  label: string;
  description?: string;
  tooltip?: string;
  command?: string;
  enabled: boolean;
  parentLabel?: string;
};

class SidebarItem extends vscode.TreeItem {
  constructor(
    public readonly kind: 'group' | 'action' | 'project' | 'info',
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly groupId?: SidebarGroupId,
    public readonly repoName?: string
  ) {
    super(label, collapsibleState);
  }
}

function getStateLabel(state: ProxyState): string {
  if (state === 'starting') {
    return 'Starting';
  }
  if (state === 'connected') {
    return 'Connected';
  }
  if (state === 'failed') {
    return 'Failed';
  }
  return 'Stopped';
}

class ProxySidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
  static readonly reverseTunnelGroupLabel = 'ReverseTunnel';
  static readonly keyProjectsGroupLabel = 'Key Projects';
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SidebarItem): Promise<SidebarItem[]> {
    if (!element) {
      return [
        this.createGroupItem('reverseTunnel', ProxySidebarProvider.reverseTunnelGroupLabel),
        this.createGroupItem('keyProjects', ProxySidebarProvider.keyProjectsGroupLabel)
      ];
    }

    if (element.kind !== 'group') {
      return [];
    }

    if (element.groupId === 'reverseTunnel') {
      return this.buildReverseTunnelItems();
    }

    if (element.groupId === 'keyProjects') {
      return this.buildKeyProjectItems();
    }

    return [];
  }

  async getItemsForTest(): Promise<{ root: SidebarTestItem[]; children: SidebarTestItem[] }> {
    const rootItems = await this.getChildren();
    const root = rootItems.map((item) => this.mapItemForTest(item));
    const childGroups = await Promise.all(
      rootItems.map(async (item) => {
        const children = await this.getChildren(item);
        return children.map((child) => this.mapItemForTest(child, String(item.label ?? '')));
      })
    );

    return {
      root,
      children: childGroups.flat()
    };
  }

  private createGroupItem(groupId: SidebarGroupId, label: string): SidebarItem {
    const item = new SidebarItem('group', label, vscode.TreeItemCollapsibleState.Expanded, groupId);
    item.iconPath = new vscode.ThemeIcon('symbol-namespace');
    return item;
  }

  private mapItemForTest(item: vscode.TreeItem, parentLabel?: string): SidebarTestItem {
    const command =
      item.command && typeof item.command === 'object' && 'command' in item.command
        ? item.command.command
        : undefined;
    const tooltip = typeof item.tooltip === 'string' ? item.tooltip : item.tooltip?.value;

    return {
      kind: item instanceof SidebarItem ? item.kind : 'unknown',
      label: String(item.label ?? ''),
      description: typeof item.description === 'string' ? item.description : undefined,
      tooltip,
      command,
      enabled: Boolean(command),
      parentLabel
    };
  }

  private buildReverseTunnelItems(): SidebarItem[] {
    const toggle = new SidebarItem(
      'action',
      proxyState === 'connected'
        ? 'ReverseTun: ON'
        : proxyState === 'starting'
          ? 'ReverseTun: CONNECTING...'
          : 'ReverseTun: OFF',
      vscode.TreeItemCollapsibleState.None,
      'reverseTunnel'
    );

    const logs = new SidebarItem('action', 'Open Logs', vscode.TreeItemCollapsibleState.None, 'reverseTunnel');
    logs.iconPath = new vscode.ThemeIcon('output');
    logs.command = { command: 'reverseProxy.showLogs', title: 'Open Logs' };
    const settings = new SidebarItem('action', 'Settings', vscode.TreeItemCollapsibleState.None, 'reverseTunnel');
    settings.iconPath = new vscode.ThemeIcon('gear');
    settings.command = { command: 'reverseProxy.openSettings', title: 'Settings' };

    if (proxyState === 'connected') {
      toggle.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
      toggle.command = { command: 'reverseProxy.sidebarToggle', title: 'Toggle Proxy' };
      return [toggle, logs, settings];
    }

    if (proxyState === 'starting') {
      toggle.iconPath = new vscode.ThemeIcon('sync~spin');
      return [toggle, logs, settings];
    }

    toggle.iconPath = new vscode.ThemeIcon('circle-large-outline', new vscode.ThemeColor('disabledForeground'));
    toggle.command = { command: 'reverseProxy.sidebarToggle', title: 'Toggle Proxy' };
    return [toggle, logs, settings];
  }

  private async buildKeyProjectItems(): Promise<SidebarItem[]> {
    const config = await getKeyProjectsConfig();
    const issue = getKeyProjectsConfigurationIssue(config);
    const items: SidebarItem[] = [];

    if (issue) {
      const info = new SidebarItem('info', issue, vscode.TreeItemCollapsibleState.None, 'keyProjects');
      info.tooltip = issue;
      items.push(info);
    } else {
      const cached = getCachedKeyProjectStatuses(config);
      if (cached) {
        for (const status of cached) {
          items.push(this.createKeyProjectItem(status));
        }
      } else {
        const info = new SidebarItem('info', 'Click Refresh to load key project status.', vscode.TreeItemCollapsibleState.None, 'keyProjects');
        info.tooltip = 'Click Refresh to load key project status.';
        items.push(info);
      }
    }

    const refreshing = Boolean(keyProjectsRefreshPromise);
    const refresh = new SidebarItem(
      'action',
      refreshing ? 'Refreshing...' : 'Refresh',
      vscode.TreeItemCollapsibleState.None,
      'keyProjects'
    );
    refresh.iconPath = new vscode.ThemeIcon(refreshing ? 'sync~spin' : 'refresh');
    if (!refreshing) {
      refresh.command = { command: 'reverseProxy.refreshKeyProjects', title: 'Refresh Key Projects' };
    }
    items.push(refresh);

    const settings = new SidebarItem('action', 'Settings', vscode.TreeItemCollapsibleState.None, 'keyProjects');
    settings.iconPath = new vscode.ThemeIcon('gear');
    settings.command = { command: 'reverseProxy.openKeyProjectSettings', title: 'Settings' };
    items.push(settings);

    return items;
  }

  private createKeyProjectItem(status: KeyProjectStatus): SidebarItem {
    const label = status.clean
      ? `\u2714\uFE0F ${status.repoName}: ${status.branch} - ${getKeyProjectSyncLabel(status)}`
      : `\u2757 ${status.repoName}: ${status.branch} - ${getKeyProjectSyncLabel(status)}`;
    const unavailableLabel = `\u26A0 ${status.repoName}: unavailable`;
    const item = new SidebarItem(
      'project',
      status.available ? label : unavailableLabel,
      vscode.TreeItemCollapsibleState.None,
      'keyProjects',
      status.repoName
    );
    item.tooltip = formatKeyProjectTooltip(status);
    item.command = {
      command: 'reverseProxy.showKeyProjectStatus',
      title: 'Show Key Project Status',
      arguments: [status.configuredRepoName]
    };
    return item;
  }
}

function setProxyState(state: ProxyState): void {
  proxyState = state;

  if (state === 'starting') {
    statusBarItem.text = '🟡 ReverseTun (Starting)';
    statusBarItem.tooltip = 'SSH reverse proxy is starting. Click to view status.';
  } else if (state === 'connected') {
    statusBarItem.text = '🟢 ReverseTun (Connected)';
    statusBarItem.tooltip = 'SSH reverse proxy is connected. Click to view status.';
  } else if (state === 'failed') {
    statusBarItem.text = '🔴 ReverseTun (Failed)';
    statusBarItem.tooltip = 'SSH reverse proxy failed. Click to view status.';
  } else {
    statusBarItem.text = '🔴 ReverseTun (Stopped)';
    statusBarItem.tooltip = 'SSH reverse proxy is stopped. Click to view status.';
  }

  sidebarViewProvider?.refresh();
}


async function updateKeyStatusBar(): Promise<void> {
  if (!keyStatusBarItem) {
    return;
  }

  keyStatusBarItem.command = 'reverseProxy.refreshKeyProjects';

  if (keyProjectsRefreshPromise) {
    keyStatusBarItem.text = '$(sync~spin) $(bookmark) Refreshing...';
    keyStatusBarItem.tooltip = 'Refreshing key project status.';
    keyStatusBarItem.show();
    return;
  }

  const config = await getKeyProjectsConfig();
  const issue = getKeyProjectsConfigurationIssue(config);
  if (issue) {
    keyStatusBarItem.text = '$(bookmark) setup';
    keyStatusBarItem.tooltip = issue;
    keyStatusBarItem.command = 'reverseProxy.openKeyProjectSettings';
    keyStatusBarItem.show();
    return;
  }

  const cached = getCachedKeyProjectStatuses(config);
  const first = cached?.[0];
  if (!first) {
    keyStatusBarItem.text = '$(bookmark) not loaded';
    keyStatusBarItem.tooltip = 'Click to refresh key project status.';
    keyStatusBarItem.show();
    return;
  }

  keyStatusBarItem.text = `$(bookmark) ${first.repoName} - ${first.branch}`;
  keyStatusBarItem.tooltip = formatKeyProjectTooltip(first);
  keyStatusBarItem.show();
}

function assertString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid config field '${key}': expected non-empty string.`);
  }
  return value.trim();
}

function assertNumber(value: unknown, key: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Invalid config field '${key}': expected number.`);
  }
  return value;
}

function assertStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid config field '${key}': expected string array.`);
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().replace(/[\\/]+$/g, ''))
    .filter((entry) => entry.length > 0);
}

function getWorkspaceFolderUri(workspacePath?: string): vscode.Uri | null {
  const overridePath = workspacePath ?? keyProjectsWorkspaceOverride;
  if (overridePath) {
    return vscode.Uri.file(overridePath);
  }

  return vscode.workspace.workspaceFolders?.[0]?.uri ?? null;
}

function getKeyProjectsConfigUri(workspacePath?: string): vscode.Uri | null {
  const workspaceUri = getWorkspaceFolderUri(workspacePath);
  return workspaceUri ? vscode.Uri.joinPath(workspaceUri, '.vscode', 'mytoolbox.json') : null;
}

function getDefaultKeyProjectsConfigContent(): string {
  return `${JSON.stringify(
    {
      keyProjects: {
        mode: 'local',
        rootDir: '',
        repoNames: [],
        sshTarget: '',
        sshPort: 22,
        gitPath: 'git',
        sshPath: 'ssh'
      }
    },
    null,
    2
  )}
`;
}

function isFileNotFoundError(error: unknown): boolean {
  if (error instanceof vscode.FileSystemError) {
    const details = `${error.name} ${error.message}`;
    return /FileNotFound|EntryNotFound|ENOENT/i.test(details);
  }

  const details = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /FileNotFound|EntryNotFound|ENOENT/i.test(details);
}

async function getKeyProjectsConfig(workspacePath?: string): Promise<KeyProjectsConfig> {
  const configUri = getKeyProjectsConfigUri(workspacePath);
  if (!configUri) {
    const result = {
      mode: 'local' as KeyProjectsMode,
      rootDir: '',
      repoNames: [],
      sshTarget: '',
      sshPort: 22,
      gitPath: 'git',
      sshPath: 'ssh',
      loadedConfigPath: '<no-workspace>',
      configExists: false,
      workspaceAvailable: false
    };

    outputChannel?.appendLine('[key-projects] config path=<no-workspace> exists=false mode=local rootDir=<empty> repos=<none> sshTarget=<empty> sshPort=22');
    return result;
  }

  let parsed: Record<string, unknown> | null = null;

  try {
    const bytes = await vscode.workspace.fs.readFile(configUri);
    const rawText = Buffer.from(bytes).toString('utf8');
    const raw = JSON.parse(rawText) as unknown;
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Invalid config file '${configUri.toString()}': root must be a JSON object.`);
    }
    parsed = raw as Record<string, unknown>;
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }

  const section =
    parsed && parsed.keyProjects && typeof parsed.keyProjects === 'object'
      ? (parsed.keyProjects as Record<string, unknown>)
      : {};
  const rawMode = typeof section.mode === 'string' ? section.mode.trim().toLowerCase() : 'local';
  const mode: KeyProjectsMode = rawMode === 'ssh' ? 'ssh' : 'local';

  const result = {
    mode,
    rootDir: typeof section.rootDir === 'string' ? section.rootDir.trim() : '',
    repoNames: assertStringArray(section.repoNames ?? [], 'keyProjects.repoNames'),
    sshTarget: typeof section.sshTarget === 'string' ? section.sshTarget.trim() : '',
    sshPort: typeof section.sshPort === 'number' && Number.isFinite(section.sshPort) ? Math.max(1, section.sshPort) : 22,
    gitPath: typeof section.gitPath === 'string' && section.gitPath.trim() ? section.gitPath.trim() : 'git',
    sshPath: typeof section.sshPath === 'string' && section.sshPath.trim() ? section.sshPath.trim() : 'ssh',
    loadedConfigPath: configUri.toString(),
    configExists: Boolean(parsed),
    workspaceAvailable: true
  };

  outputChannel?.appendLine(
    `[key-projects] config path=${result.loadedConfigPath} exists=${result.configExists} mode=${result.mode} rootDir=${result.rootDir || '<empty>'} repos=${result.repoNames.join(', ') || '<none>'} sshTarget=${result.sshTarget || '<empty>'} sshPort=${result.sshPort}`
  );

  return result;
}

function getKeyProjectsConfigurationIssue(config: KeyProjectsConfig): string | null {
  if (!config.workspaceAvailable) {
    return 'Open a workspace folder to use key projects.';
  }

  if (!config.configExists) {
    return 'Create .vscode/mytoolbox.json to list key projects.';
  }

  if (!config.rootDir) {
    return 'Set keyProjects.rootDir in .vscode/mytoolbox.json.';
  }

  if (config.repoNames.length === 0) {
    return 'Set keyProjects.repoNames in .vscode/mytoolbox.json.';
  }

  if (config.mode === 'ssh' && !config.sshTarget) {
    return 'Set keyProjects.sshTarget in .vscode/mytoolbox.json when mode is ssh.';
  }

  return null;
}

async function openKeyProjectsSettings(workspacePath?: string): Promise<string> {
  const workspaceUri = getWorkspaceFolderUri(workspacePath);
  if (!workspaceUri) {
    throw new Error('Open a workspace folder before editing key project settings.');
  }

  const configUri = vscode.Uri.joinPath(workspaceUri, '.vscode', 'mytoolbox.json');
  const configDir = vscode.Uri.joinPath(workspaceUri, '.vscode');

  outputChannel?.appendLine(`[key-projects] opening settings file ${configUri.toString()}`);

  try {
    await vscode.workspace.fs.stat(configDir);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
    await vscode.workspace.fs.createDirectory(configDir);
  }

  try {
    await vscode.workspace.fs.stat(configUri);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
    await vscode.workspace.fs.writeFile(configUri, Buffer.from(getDefaultKeyProjectsConfigContent(), 'utf8'));
  }

  const doc = await vscode.workspace.openTextDocument(configUri);
  await vscode.window.showTextDocument(doc, { preview: false });
  return configUri.scheme === 'file' ? configUri.fsPath : configUri.toString();
}

function getRepoPath(rootDir: string, repoName: string, mode: KeyProjectsMode): string {
  if (repoName === '.') {
    return mode === 'ssh' ? rootDir.replace(/\\/g, '/') : rootDir;
  }

  if (mode === 'ssh') {
    return path.posix.join(rootDir.replace(/\\/g, '/'), repoName);
  }

  return path.join(rootDir, repoName);
}

function getRepoDisplayName(repoPath: string, mode: KeyProjectsMode): string {
  const normalized = mode === 'ssh'
    ? repoPath.replace(/\\/g, '/').replace(/\/+$/g, '')
    : repoPath.replace(/[\\/]+$/g, '');
  const displayName = mode === 'ssh' ? path.posix.basename(normalized) : path.basename(normalized);
  return displayName || normalized;
}

function parseRemoteRepoName(remoteUrl: string, fallbackName: string): string {
  const trimmed = remoteUrl.trim().replace(/[\\/]+$/g, '');
  if (!trimmed) {
    return fallbackName;
  }

  const lastSegment = trimmed.split(/[/:]/).filter((segment) => segment.length > 0).pop();
  return lastSegment || fallbackName;
}

async function loadRepoDisplayName(config: KeyProjectsConfig, repoPath: string): Promise<string> {
  const fallbackName = getRepoDisplayName(repoPath, config.mode);

  try {
    const remoteUrl = (await runGitForKeyProject(config, repoPath, ['config', '--get', 'remote.origin.url'])).trim();
    return parseRemoteRepoName(remoteUrl, fallbackName);
  } catch {
    return fallbackName;
  }
}

function quotePosixShellArg(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function buildRemoteGitCommand(repoPath: string, args: string[]): string {
  return ['git', '-C', quotePosixShellArg(repoPath), ...args].join(' ');
}

function getKeyProjectsConfigSignature(config: KeyProjectsConfig): string {
  return JSON.stringify({
    mode: config.mode,
    rootDir: config.rootDir,
    repoNames: config.repoNames,
    sshTarget: config.sshTarget,
    sshPort: config.sshPort,
    gitPath: config.gitPath,
    sshPath: config.sshPath,
    loadedConfigPath: config.loadedConfigPath,
    configExists: config.configExists,
    workspaceAvailable: config.workspaceAvailable
  });
}

function invalidateKeyProjectsCache(reason: string): void {
  keyProjectsCache = null;
}

function getCachedKeyProjectStatuses(config: KeyProjectsConfig): KeyProjectStatus[] | null {
  const signature = getKeyProjectsConfigSignature(config);
  if (keyProjectsCache?.signature !== signature) {
    return null;
  }

  return keyProjectsCache.statuses;
}

function setCachedKeyProjectStatuses(config: KeyProjectsConfig, statuses: KeyProjectStatus[]): void {
  keyProjectsCache = {
    signature: getKeyProjectsConfigSignature(config),
    statuses
  };
}

function parseGitStatusSummary(output: string): {
  branch: string;
  upstream?: string;
  syncState: 'synced' | 'ahead' | 'behind' | 'diverged' | 'no-upstream' | 'unknown';
  aheadCount: number;
  behindCount: number;
  shortStatus: string;
  clean: boolean;
} {
  const lines = output.replace(/\r/g, '').split('\n');
  let branch = 'HEAD';
  let upstream: string | undefined;
  let aheadCount = 0;
  let behindCount = 0;
  const shortLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('# branch.head ')) {
      branch = trimmed.slice('# branch.head '.length).trim() || 'HEAD';
      continue;
    }

    if (trimmed.startsWith('# branch.upstream ')) {
      upstream = trimmed.slice('# branch.upstream '.length).trim() || undefined;
      continue;
    }

    if (trimmed.startsWith('# branch.ab ')) {
      const match = trimmed.match(/^# branch\.ab \+(\d+) \-(\d+)$/);
      if (match) {
        aheadCount = Number(match[1]);
        behindCount = Number(match[2]);
      }
      continue;
    }

    if (!trimmed.startsWith('# ')) {
      shortLines.push(trimmed);
    }
  }

  let syncState: KeyProjectStatus['syncState'] = 'unknown';
  if (!upstream) {
    syncState = 'no-upstream';
  } else if (aheadCount > 0 && behindCount > 0) {
    syncState = 'diverged';
  } else if (aheadCount > 0) {
    syncState = 'ahead';
  } else if (behindCount > 0) {
    syncState = 'behind';
  } else {
    syncState = 'synced';
  }

  return {
    branch,
    upstream,
    syncState,
    aheadCount,
    behindCount,
    shortStatus: shortLines.join('\n'),
    clean: shortLines.length === 0
  };
}

function runCommand(command: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      outputChannel?.appendLine(`[key-projects] command error: ${error.message}`);
      reject(new Error(`Failed to run ${command}: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        return;
      }
      if (code !== 0) {
        const details = stderr.trim() || stdout.trim() || `exit code ${code}`;
        outputChannel?.appendLine(`[key-projects] command failed: ${details}`);
        reject(new Error(details));
        return;
      }
      resolve(stdout.trimEnd());
    });
  });
}

async function runGitForKeyProject(
  config: KeyProjectsConfig,
  repoPath: string,
  args: string[],
  timeoutMs?: number
): Promise<string> {
  if (config.mode === 'ssh') {
    const sshArgs = config.sshPort === 22
      ? [config.sshTarget, buildRemoteGitCommand(repoPath, args)]
      : ['-p', String(config.sshPort), config.sshTarget, buildRemoteGitCommand(repoPath, args)];
    return runCommand(config.sshPath, sshArgs, timeoutMs);
  }

  return runCommand(config.gitPath, ['-C', repoPath, ...args], timeoutMs);
}

async function loadKeyProjectStatus(config: KeyProjectsConfig, repoName: string): Promise<KeyProjectStatus> {
  const repoPath = getRepoPath(config.rootDir, repoName, config.mode);
  const displayName = await loadRepoDisplayName(config, repoPath);

  try {
    let fetchError: string | undefined;
    try {
      await runGitForKeyProject(config, repoPath, ['fetch', '--prune', '--quiet'], 20000);
    } catch (error) {
      fetchError = error instanceof Error ? error.message : String(error);
      outputChannel?.appendLine(`[key-projects] fetch warning repo=${repoName}: ${fetchError}`);
    }

    const summary = await runGitForKeyProject(config, repoPath, ['status', '--porcelain=v2', '--branch']);
    const parsed = parseGitStatusSummary(summary.trimEnd());

    return {
      configuredRepoName: repoName,
      repoName: displayName,
      repoPath,
      branch: parsed.branch,
      upstream: parsed.upstream,
      syncState: fetchError ? 'unknown' : parsed.syncState,
      aheadCount: parsed.aheadCount,
      behindCount: parsed.behindCount,
      shortStatus: parsed.shortStatus,
      clean: parsed.clean,
      available: true,
      fetchError
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel?.appendLine(`[key-projects] failed repo=${repoName}: ${message}`);
    return {
      configuredRepoName: repoName,
      repoName: displayName,
      repoPath,
      branch: 'unknown',
      syncState: 'unknown',
      aheadCount: 0,
      behindCount: 0,
      shortStatus: '',
      clean: false,
      available: false,
      error: message
    };
  }
}

async function loadKeyProjectStatuses(config: KeyProjectsConfig): Promise<KeyProjectStatus[]> {
  outputChannel?.appendLine(`[key-projects] refresh start count=${config.repoNames.length}`);
  const statuses: KeyProjectStatus[] = [];
  for (const repoName of config.repoNames) {
    statuses.push(await loadKeyProjectStatus(config, repoName));
  }
  return statuses;
}

async function refreshKeyProjects(): Promise<void> {
  if (keyProjectsRefreshPromise) {
    return keyProjectsRefreshPromise;
  }

  keyProjectsRefreshPromise = (async () => {
    const config = await getKeyProjectsConfig();
    const issue = getKeyProjectsConfigurationIssue(config);
    if (issue) {
      outputChannel?.appendLine(`[key-projects] refresh skipped: ${issue}`);
      invalidateKeyProjectsCache('configuration issue');
      sidebarViewProvider?.refresh();
      await updateKeyStatusBar();
      return;
    }

    const statuses = await loadKeyProjectStatuses(config);
    setCachedKeyProjectStatuses(config, statuses);
    outputChannel?.appendLine(`[key-projects] refresh complete count=${statuses.length}`);
    sidebarViewProvider?.refresh();
    await updateKeyStatusBar();
  })();

  sidebarViewProvider?.refresh();
  void updateKeyStatusBar();

  try {
    await keyProjectsRefreshPromise;
  } finally {
    keyProjectsRefreshPromise = null;
    sidebarViewProvider?.refresh();
    await updateKeyStatusBar();
  }
}

function formatKeyProjectTooltip(status: KeyProjectStatus): vscode.MarkdownString {
  const escape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  const code = (value: string): string => '`' + escape(value) + '`';
  const lines = [
    '- repo: ' + code(status.repoName),
    '- branch: ' + code(status.branch),
    '- remote: ' + code(getKeyProjectSyncLabel(status)),
    '- status: ' + code(status.available ? (status.clean ? 'clean' : 'dirty') : 'unavailable'),
    '- path: ' + code(status.repoPath)
  ];

  if (!status.available) {
    lines.push('- error: ' + code(status.error ?? 'Unavailable'));
  } else {
    lines.push('- upstream: ' + code(status.upstream ?? 'not configured'));
    lines.push('- fetch: ' + code(status.fetchError ? 'failed (' + status.fetchError + ')' : 'ok'));

    if (status.clean) {
      lines.push('- changes: ' + code('working tree clean'));
    } else {
      lines.push('- changes:');
      for (const entry of status.shortStatus.split('\n').filter((line) => line.trim().length > 0)) {
        lines.push('  - ' + code(entry));
      }
    }
  }

  return new vscode.MarkdownString(lines.join('\n'));
}

function getKeyProjectSyncLabel(status: Pick<KeyProjectStatus, 'syncState' | 'aheadCount' | 'behindCount'>): string {
  switch (status.syncState) {
    case 'synced':
      return 'synced';
    case 'ahead':
      return 'ahead ' + status.aheadCount;
    case 'behind':
      return 'behind ' + status.behindCount;
    case 'diverged':
      return 'diverged +' + status.aheadCount + '/-' + status.behindCount;
    case 'no-upstream':
      return 'no upstream';
    default:
      return 'sync unknown';
  }
}

function formatKeyProjectOutput(status: KeyProjectStatus): string {
  const lines = [
    '[key-project] repo=' + status.repoName,
    'Path: ' + status.repoPath,
    'Branch: ' + status.branch,
    'Upstream: ' + (status.upstream ?? 'not configured'),
    'Remote Sync: ' + getKeyProjectSyncLabel(status),
    'Fetch: ' + (status.fetchError ? 'failed (' + status.fetchError + ')' : 'ok'),
    'Status: ' + (status.available ? (status.clean ? 'clean' : 'dirty') : 'unavailable'),
    '',
    status.available ? (status.fullStatus ?? '') : 'Error: ' + (status.error ?? 'Unavailable')
  ];

  return lines.join('\n').trim();
}

async function showKeyProjectStatus(repoName: string): Promise<string> {
  const config = await getKeyProjectsConfig();
  const repoPath = getRepoPath(config.rootDir, repoName, config.mode);
  const displayName = await loadRepoDisplayName(config, repoPath);
  let status = getCachedKeyProjectStatuses(config)?.find((entry) => entry.configuredRepoName === repoName) ?? {
    configuredRepoName: repoName,
    repoName: displayName,
    repoPath,
    branch: 'unknown',
    syncState: 'unknown',
    aheadCount: 0,
    behindCount: 0,
    shortStatus: '',
    clean: false,
    available: false,
    error: 'Status not loaded. Click Refresh first.'
  };

  if (status.available) {
    try {
      const fullStatus = (await runGitForKeyProject(config, repoPath, ['status'])).trim();
      status = { ...status, fullStatus };
      const cached = getCachedKeyProjectStatuses(config);
      if (cached) {
        setCachedKeyProjectStatuses(
          config,
          cached.map((entry) => (entry.configuredRepoName === repoName ? status : entry))
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status = { ...status, available: false, error: message, fullStatus: message };
    }
  }

  const text = formatKeyProjectOutput(status);
  outputChannel.appendLine(`[key-projects] showing detailed status for repo=${repoName} display=${status.repoName}`);
  outputChannel.appendLine(text);
  outputChannel.show(true);
  return text;
}

function resolveConfiguredConfigPathWithContext(configFile: string, options?: ResolvePathOptions): string {
  if (path.isAbsolute(configFile)) {
    return configFile;
  }

  const workspaceFolder = options?.workspaceFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const remoteName = options?.remoteName ?? vscode.env.remoteName;
  const homeDir = options?.homeDir ?? os.homedir();

  if (!remoteName && workspaceFolder) {
    return path.join(workspaceFolder, configFile);
  }

  return path.join(homeDir, configFile);
}

function resolveConfigPathWithContext(configFile: string, options?: ResolvePathOptions): string {
  if (path.isAbsolute(configFile)) {
    return configFile;
  }

  const workspaceFolder = options?.workspaceFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const remoteName = options?.remoteName ?? vscode.env.remoteName;
  const homeDir = options?.homeDir ?? os.homedir();
  const extensionPath = options?.extensionPath ?? extensionContextRef?.extensionPath;

  if (!remoteName && workspaceFolder) {
    const workspacePath = path.join(workspaceFolder, configFile);
    if (fs.existsSync(workspacePath)) {
      return workspacePath;
    }
  }

  const homePath = path.join(homeDir, configFile);
  if (fs.existsSync(homePath)) {
    return homePath;
  }

  if (!extensionPath) {
    throw new Error('Extension context is not initialized.');
  }

  return path.join(extensionPath, 'resources', 'reverse-proxy.config.json');
}

function resolveConfigPath(configFile: string): string {
  return resolveConfigPathWithContext(configFile);
}

function resolveConfiguredConfigPath(configFile: string): string {
  return resolveConfiguredConfigPathWithContext(configFile);
}

function loadFileProxyConfig(filePath: string): FileProxyConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse config file '${filePath}': ${message}`);
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid config file '${filePath}': root must be a JSON object.`);
  }

  const root = raw as Record<string, unknown>;
  const section = root.ReverseTunnel;
  if (!section || typeof section !== 'object') {
    throw new Error(`Invalid config file '${filePath}': missing object field 'ReverseTunnel'.`);
  }

  const data = section as Record<string, unknown>;
  const identityFile = typeof data.identityFile === 'string' ? data.identityFile.trim() : '';
  const connectionReadyDelayMs = assertNumber(data.connectionReadyDelayMs, 'ReverseTunnel.connectionReadyDelayMs');
  if (connectionReadyDelayMs <= 0) {
    throw new Error(`Invalid config field 'ReverseTunnel.connectionReadyDelayMs': expected > 0.`);
  }

  return {
    sshPath: assertString(data.sshPath, 'ReverseTunnel.sshPath'),
    connectionReadyDelayMs,
    remoteHost: assertString(data.remoteHost, 'ReverseTunnel.remoteHost'),
    remotePort: assertNumber(data.remotePort, 'ReverseTunnel.remotePort'),
    remoteUser: assertString(data.remoteUser, 'ReverseTunnel.remoteUser'),
    remoteBindPort: assertNumber(data.remoteBindPort, 'ReverseTunnel.remoteBindPort'),
    localHost: assertString(data.localHost, 'ReverseTunnel.localHost'),
    localPort: assertNumber(data.localPort, 'ReverseTunnel.localPort'),
    identityFile
  };
}

function getConfig(): RuntimeProxyConfig {
  const config = vscode.workspace.getConfiguration('reverseProxy');
  const configFile = config.get<string>('configFile', 'reverse-proxy.config.json');
  const configPath = resolveConfigPath(configFile);
  const fileConfig = loadFileProxyConfig(configPath);

  return {
    ...fileConfig,
    loadedConfigPath: configPath
  };
}

function verifySshExists(sshPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = spawn(sshPath, ['-V']);

    const onData = (data: Buffer) => {
      outputChannel.appendLine(`[ssh-check] ${data.toString().trim()}`);
    };

    check.stdout.on('data', onData);
    check.stderr.on('data', onData);

    check.on('error', (err) => {
      reject(new Error(`Cannot run ssh command '${sshPath}': ${err.message}`));
    });

    check.on('close', (code) => {
      if (code === 0 || code === 255) {
        resolve();
      } else {
        reject(new Error(`ssh check exited with code ${code}`));
      }
    });
  });
}

function normalizeCommandLine(commandLine: string): string {
  return commandLine.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandLineHasArg(commandLine: string, value: string): boolean {
  const pattern = new RegExp(`(^|\\s|["'])${escapeRegExp(value)}(?=\\s|["']|$)`, 'i');
  return pattern.test(commandLine);
}

function isMatchingTunnelCommand(commandLine: string, config: RuntimeProxyConfig): boolean {
  const normalized = normalizeCommandLine(commandLine);
  if (!normalized) {
    return false;
  }

  const reverseSpec = `${config.remoteBindPort}:${config.localHost}:${config.localPort}`;
  const reverseSpecLower = reverseSpec.toLowerCase();
  const remoteTarget = `${config.remoteUser}@${config.remoteHost}`;
  const normalizedLower = normalized.toLowerCase();

  const hasReverseFlag = /(^|\s)-R(?=\s|$)/i.test(normalized);
  const hasReverseSpec = normalizedLower.includes(reverseSpecLower);
  if (!hasReverseFlag || !hasReverseSpec) {
    return false;
  }

  const hasRemoteTarget =
    commandLineHasArg(normalized, remoteTarget) ||
    commandLineHasArg(normalized, config.remoteHost) ||
    commandLineHasArg(normalized, config.remoteUser);

  if (!hasRemoteTarget) {
    return false;
  }

  return true;
}

function buildWindowsProcessInspectionScript(): string {
  return [
    '$ErrorActionPreference = "Stop";',
    'Get-CimInstance Win32_Process |',
    '  Where-Object { $_.CommandLine } |',
    '  Select-Object ProcessId, CommandLine |',
    '  ConvertTo-Json -Compress'
  ].join(' ');
}

function listCandidateProcesses(): Promise<ExistingTunnelMatch[]> {
  return new Promise((resolve, reject) => {
    if (process.platform === 'win32') {
      const script = buildWindowsProcessInspectionScript();
      const inspector = spawn('powershell.exe', ['-NoProfile', '-Command', script]);
      let stdout = '';
      let stderr = '';

      inspector.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      inspector.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      inspector.on('error', (error) => {
        reject(new Error(`Failed to inspect existing processes: ${error.message}`));
      });
      inspector.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Process inspection exited with code ${code}: ${stderr.trim()}`));
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          resolve([]);
          return;
        }

        try {
          const parsed = JSON.parse(trimmed) as
            | { ProcessId?: number; CommandLine?: string }
            | Array<{ ProcessId?: number; CommandLine?: string }>;
          const entries = Array.isArray(parsed) ? parsed : [parsed];
          resolve(
            entries
              .filter((entry) => typeof entry.ProcessId === 'number' && typeof entry.CommandLine === 'string')
              .map((entry) => ({
                pid: entry.ProcessId as number,
                commandLine: entry.CommandLine as string
              }))
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          reject(new Error(`Failed to parse process inspection output: ${message}`));
        }
      });
      return;
    }

    const inspector = spawn('ps', ['-ax', '-o', 'pid=', '-o', 'command=']);
    let stdout = '';
    let stderr = '';

    inspector.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    inspector.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    inspector.on('error', (error) => {
      reject(new Error(`Failed to inspect existing processes: ${error.message}`));
    });
    inspector.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Process inspection exited with code ${code}: ${stderr.trim()}`));
        return;
      }

      const matches = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const match = line.match(/^(\d+)\s+(.*)$/);
          if (!match) {
            return null;
          }
          return {
            pid: Number(match[1]),
            commandLine: match[2]
          };
        })
        .filter((entry): entry is ExistingTunnelMatch => Boolean(entry));
      resolve(matches);
    });
  });
}

async function findExistingTunnelProcess(config: RuntimeProxyConfig): Promise<ExistingTunnelMatch | null> {
  const processes = await listCandidateProcesses();
  const currentPid = process.pid;

  for (const candidate of processes) {
    if (candidate.pid === currentPid) {
      continue;
    }
    if (sshProcess?.pid && candidate.pid === sshProcess.pid) {
      return candidate;
    }
    if (isMatchingTunnelCommand(candidate.commandLine, config)) {
      return candidate;
    }
  }

  return null;
}

async function syncProxyStateFromSystem(config?: RuntimeProxyConfig): Promise<boolean> {
  let runtimeConfig = config;
  if (!runtimeConfig) {
    try {
      runtimeConfig = getConfig();
    } catch {
      return false;
    }
  }

  try {
    const existing = await findExistingTunnelProcess(runtimeConfig);
    if (!existing) {
      externalTunnelPid = null;
      if (!sshProcess && proxyState === 'connected') {
        setProxyState('stopped');
      }
      return false;
    }

    externalTunnelPid = sshProcess?.pid === existing.pid ? null : existing.pid;
    if (proxyState !== 'connected') {
      outputChannel.appendLine(`[sync] detected existing reverse tunnel process pid=${existing.pid}`);
      setProxyState('connected');
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[warn] unable to inspect existing tunnel processes: ${message}`);
    return false;
  }
}

async function startProxy(): Promise<void> {
  if (sshProcess) {
    vscode.window.showInformationMessage('Reverse proxy is already running.');
    return;
  }

  let config: RuntimeProxyConfig;
  try {
    config = getConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[error] ${message}`);
    setProxyState('failed');
    vscode.window.showErrorMessage(`Failed to load reverse proxy config: ${message}`);
    return;
  }

  const remoteTarget = `${config.remoteUser}@${config.remoteHost}`;
  const reverseSpec = `${config.remoteBindPort}:${config.localHost}:${config.localPort}`;
  outputChannel.appendLine(`[config] using file: ${config.loadedConfigPath}`);
  if (vscode.env.remoteName) {
    outputChannel.appendLine(`[mode] workspace is remote (${vscode.env.remoteName}), tunnel runs on local UI host.`);
  }

  if (await syncProxyStateFromSystem(config)) {
    vscode.window.showInformationMessage('Reverse proxy is already running in another VS Code window.');
    return;
  }

  setProxyState('starting');

  try {
    await verifySshExists(config.sshPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[error] ${message}`);
    setProxyState('failed');
    vscode.window.showErrorMessage(
      `SSH command is unavailable. Install OpenSSH or update 'sshPath' in reverse-proxy.config.json. Details: ${message}`
    );
    return;
  }

  const args = [
    '-N',
    '-p',
    String(config.remotePort),
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    '-R',
    reverseSpec
  ];

  if (config.identityFile.length > 0) {
    args.push('-i', config.identityFile);
  }

  args.push(remoteTarget);

  outputChannel.appendLine(`[start] ${config.sshPath} ${args.join(' ')}`);

  try {
    sshProcess = spawn(config.sshPath, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[error] failed to spawn ssh: ${message}`);
    vscode.window.showErrorMessage(`Failed to start reverse proxy: ${message}`);
    sshProcess = null;
    return;
  }

  stopRequested = false;
  externalTunnelPid = null;
  let hasFailed = false;
  const markFailed = (message: string): void => {
    if (hasFailed) {
      return;
    }
    hasFailed = true;
    outputChannel.appendLine(`[error] ${message}`);
    setProxyState('failed');
    vscode.window.showErrorMessage(message);
  };

  if (connectTimer) {
    clearTimeout(connectTimer);
  }
  connectTimer = setTimeout(() => {
    if (sshProcess && !hasFailed && !stopRequested) {
      setProxyState('connected');
      vscode.window.showInformationMessage('Reverse proxy connected.');
    }
  }, config.connectionReadyDelayMs);

  sshProcess.stdout.on('data', (data: Buffer) => {
    outputChannel.appendLine(`[stdout] ${data.toString().trim()}`);
  });

  sshProcess.stderr.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    outputChannel.appendLine(`[stderr] ${text}`);

    if (/remote port forwarding failed/i.test(text) || /address already in use/i.test(text)) {
      markFailed(`Reverse proxy failed: remote port ${config.remoteBindPort} is already in use.`);
      if (sshProcess) {
        sshProcess.kill();
      }
    }
  });

  sshProcess.on('error', (err: Error) => {
    markFailed(`Reverse proxy failed: ${err.message}`);
  });

  sshProcess.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    outputChannel.appendLine(`[stop] ssh exited with code=${code} signal=${signal}`);
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }

    if (stopRequested) {
      setProxyState('stopped');
    } else if (hasFailed) {
      // Keep failed state.
    } else if (proxyState === 'starting') {
      markFailed(`Reverse proxy failed before connection established (code=${code}, signal=${signal}).`);
    } else if (proxyState === 'connected') {
      markFailed(`Reverse proxy disconnected unexpectedly (code=${code}, signal=${signal}).`);
    } else {
      setProxyState('stopped');
    }

    sshProcess = null;
    externalTunnelPid = null;
    stopRequested = false;
  });

  outputChannel.show(true);
}

function stopProxy(): void {
  if (!sshProcess && !externalTunnelPid) {
    vscode.window.showInformationMessage('Reverse proxy is not running.');
    return;
  }

  outputChannel.appendLine('[stop] stopping ssh reverse proxy');
  stopRequested = true;
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
  if (sshProcess) {
    sshProcess.kill();
    sshProcess = null;
  } else if (externalTunnelPid) {
    try {
      process.kill(externalTunnelPid);
      outputChannel.appendLine(`[stop] sent termination signal to existing reverse tunnel pid=${externalTunnelPid}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`[warn] failed to stop existing reverse tunnel pid=${externalTunnelPid}: ${message}`);
      vscode.window.showErrorMessage(`Failed to stop reverse proxy process ${externalTunnelPid}: ${message}`);
      return;
    }
  }
  externalTunnelPid = null;
  setProxyState('stopped');
  vscode.window.showInformationMessage('Reverse proxy stopping...');
}

async function toggleProxyFromSidebar(): Promise<void> {
  if (proxyState === 'starting') {
    return;
  }

  if (proxyState === 'connected' || sshProcess || externalTunnelPid) {
    stopProxy();
    return;
  }

  await startProxy();
}

function showStatus(): void {
  vscode.window.showInformationMessage(`Reverse proxy status: ${getStateLabel(proxyState)}`);
}

function showLogs(): void {
  outputChannel.show(true);
}

function getDefaultConfigJsonContent(): string {
  return JSON.stringify(
    {
      ReverseTunnel: {
        sshPath: 'ssh',
        connectionReadyDelayMs: 1200,
        remoteHost: 'FOO_ADDRESS',
        remotePort: 4001,
        remoteUser: 'FOO_USER',
        remoteBindPort: 17897,
        localHost: '127.0.0.1',
        localPort: 7897,
        identityFile: ''
      }
    },
    null,
    2
  );
}

async function openSettingsConfig(): Promise<void> {
  const reverseProxyConfig = vscode.workspace.getConfiguration('reverseProxy');
  const configuredPath = reverseProxyConfig.get<string>('configFile', 'reverse-proxy.config.json');
  const currentPath = resolveConfiguredConfigPath(configuredPath);

  let finalConfigPath = currentPath;

  if (!fs.existsSync(currentPath)) {
    const defaultUri =
      !vscode.env.remoteName && vscode.workspace.workspaceFolders?.[0]?.uri
        ? vscode.workspace.workspaceFolders[0].uri
        : vscode.Uri.file(os.homedir());

    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select',
      defaultUri
    });

    if (!selected || selected.length === 0) {
      return;
    }

    const selectedDir = selected[0].fsPath;
    finalConfigPath = path.join(selectedDir, 'configs.json');

    if (!fs.existsSync(finalConfigPath)) {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(finalConfigPath),
        Buffer.from(getDefaultConfigJsonContent(), 'utf8')
      );
    }

    await reverseProxyConfig.update('configFile', finalConfigPath, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(`Config file created: ${finalConfigPath}`);
  }

  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(finalConfigPath));
  await vscode.window.showTextDocument(doc, { preview: false });
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContextRef = context;
  outputChannel = vscode.window.createOutputChannel('Reverse Proxy');
  keyStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 150);
  keyStatusBarItem.command = 'reverseProxy.refreshKeyProjects';
  keyStatusBarItem.text = '$(bookmark) not loaded';
  keyStatusBarItem.tooltip = 'Click to refresh key project status.';
  keyStatusBarItem.show();

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'reverseProxy.showStatus';
  setProxyState('stopped');
  statusBarItem.show();
  sidebarViewProvider = new ProxySidebarProvider();

  if (vscode.env.remoteName) {
    outputChannel.appendLine(`[mode] remote workspace detected (${vscode.env.remoteName}); extension runs on local UI host.`);
  }

  void syncProxyStateFromSystem();
  void updateKeyStatusBar();

  const keyProjectsWatchers = (vscode.workspace.workspaceFolders ?? []).map((folder) => {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.vscode/mytoolbox.json'));
    watcher.onDidChange(() => {
      invalidateKeyProjectsCache('config file changed');
      sidebarViewProvider?.refresh();
      void updateKeyStatusBar();
    });
    watcher.onDidCreate(() => {
      invalidateKeyProjectsCache('config file created');
      sidebarViewProvider?.refresh();
      void updateKeyStatusBar();
    });
    watcher.onDidDelete(() => {
      invalidateKeyProjectsCache('config file deleted');
      sidebarViewProvider?.refresh();
      void updateKeyStatusBar();
    });
    return watcher;
  });

  sidebarTreeView = vscode.window.createTreeView('reverseProxy.sidebarView', { treeDataProvider: sidebarViewProvider });

  context.subscriptions.push(
    outputChannel,
    keyStatusBarItem,
    statusBarItem,
    sidebarTreeView,
    ...keyProjectsWatchers,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('reverseProxy.configFile')) {
        void syncProxyStateFromSystem();
  void updateKeyStatusBar();
      }
      if (event.affectsConfiguration('reverseProxy')) {
        sidebarViewProvider?.refresh();
      }
      void updateKeyStatusBar();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.start', async () => {
      await startProxy();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.stop', () => {
      stopProxy();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.showStatus', () => {
      showStatus();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.sidebarToggle', async () => {
      await toggleProxyFromSidebar();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.showLogs', () => {
      showLogs();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.openSettings', async () => {
      await openSettingsConfig();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.openKeyProjectSettings', async () => {
      return openKeyProjectsSettings();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.refreshKeyProjects', async () => {
      await refreshKeyProjects();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.showKeyProjectStatus', async (repoName: string) => {
      return showKeyProjectStatus(repoName);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.getSidebarItems', async () => {
      if (!sidebarViewProvider) {
        return [];
      }
      return sidebarViewProvider.getItemsForTest();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.resolvePaths', (args: ResolvePathOptions & { configFile: string }) => {
      const configFile = args.configFile;
      const options: ResolvePathOptions = {
        workspaceFolder: args.workspaceFolder,
        remoteName: args.remoteName,
        homeDir: args.homeDir,
        extensionPath: args.extensionPath
      };

      return {
        loadPath: resolveConfigPathWithContext(configFile, options),
        configuredPath: resolveConfiguredConfigPathWithContext(configFile, options)
      };
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'reverseProxy.test.clickSidebarItem',
      async (args: string | { label: string; parentLabel?: string }) => {
        if (!sidebarViewProvider) {
          throw new Error('Sidebar provider is not initialized.');
        }
        const request = typeof args === 'string' ? { label: args } : args;
        const roots = await sidebarViewProvider.getChildren();
        const children = (
          await Promise.all(
            roots
              .filter((root) => !request.parentLabel || String(root.label ?? '') === request.parentLabel)
              .map((root) => sidebarViewProvider!.getChildren(root))
          )
        ).flat();
        const item = children.find((entry) => String(entry.label ?? '') === request.label);
        if (!item || !item.command) {
          throw new Error(`Sidebar item '${request.label}' is not clickable.`);
        }
        return vscode.commands.executeCommand(item.command.command, ...(item.command.arguments ?? []));
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.syncStateFromSystem', async () => {
      await syncProxyStateFromSystem();
      return {
        state: proxyState,
        externalTunnelPid
      };
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.getWindowsProcessInspectionScript', () => {
      return buildWindowsProcessInspectionScript();
    })
  );


  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.getStatusBarState', () => {
      return {
        proxyText: statusBarItem.text,
        keyText: keyStatusBarItem.text,
        keyTooltip: typeof keyStatusBarItem.tooltip === 'string' ? keyStatusBarItem.tooltip : keyStatusBarItem.tooltip?.value
      };
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.openSettingsWithDirectory', async (dir: string) => {
      const reverseProxyConfig = vscode.workspace.getConfiguration('reverseProxy');
      const configuredPath = reverseProxyConfig.get<string>('configFile', 'reverse-proxy.config.json');
      const currentPath = resolveConfiguredConfigPath(configuredPath);
      if (fs.existsSync(currentPath)) {
        throw new Error('Config path already exists; this test helper expects missing config path.');
      }

      const finalConfigPath = path.join(dir, 'configs.json');
      if (!fs.existsSync(finalConfigPath)) {
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(finalConfigPath),
          Buffer.from(getDefaultConfigJsonContent(), 'utf8')
        );
      }
      await reverseProxyConfig.update('configFile', finalConfigPath, vscode.ConfigurationTarget.Global);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(finalConfigPath));
      await vscode.window.showTextDocument(doc, { preview: false });
      return finalConfigPath;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.setKeyProjectsWorkspaceOverride', async (workspacePath?: string | null) => {
      keyProjectsWorkspaceOverride = workspacePath ?? null;
      sidebarViewProvider?.refresh();
      return keyProjectsWorkspaceOverride;
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.openKeyProjectSettingsWithDirectory', async (dir: string) => {
      return openKeyProjectsSettings(dir);
    })
  );
}

export function deactivate(): void {
  sidebarTreeView = null;
  sidebarViewProvider = null;
  externalTunnelPid = null;
  if (keyStatusBarItem) {
    keyStatusBarItem.dispose();
  }
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
  if (sshProcess) {
    sshProcess.kill();
    sshProcess = null;
  }
}



