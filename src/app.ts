import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { renderToolBoxWebview } from './webview/render';
import { ToolBoxWebviewProvider } from './webview/toolBoxWebview';
import { createTimestampedOutputChannel, formatLogLine } from './shared/logging';
import { assertNumber, assertObject, assertString, assertStringArray } from './shared/validation';
import { getKeyProjectSyncLabel, parseGitStatusSummary } from './pinnedProjects/gitStatus';
import {
  buildRemoteGitCommand,
  buildRemoteKeyProjectsBatchScript,
  buildRemoteKeyProjectsBootstrapCommand,
  buildRemoteKeyProjectsBootstrapScript,
  getRemoteKeyProjectsBatchToken,
  getRemoteKeyProjectsRunDir,
  getRemoteKeyProjectsScriptPath,
  parseBatchedSshKeyProjectResults
} from './pinnedProjects/remoteBatch';
import {
  getDefaultConfigJsonContent,
  getRuntimeProxyConfigFromFileConfig,
  parseFileProxyConfigContent,
  resolveConfigPathWithContext as resolveConfigPathWithContextCore,
  resolveConfiguredConfigPathWithContext as resolveConfiguredConfigPathWithContextCore
} from './reverseTunnel/config';
import { ReverseTunnelService } from './reverseTunnel/service';
import { PinnedProjectsService } from './pinnedProjects/service';

let outputChannel: vscode.OutputChannel;
let extensionContextRef: vscode.ExtensionContext | null = null;
let toolBoxWebviewProvider: ToolBoxWebviewProvider | null = null;
let reverseTunnelService: ReverseTunnelService | null = null;
let pinnedProjectsService: PinnedProjectsService | null = null;
let keyProjectsWorkspaceOverride: string | null = null;
let keyProjectsCache: KeyProjectsCache | null = null;
let keyProjectsRefreshPromise: Promise<void> | null = null;
let favoriteWorkspacesRefreshPromise: Promise<void> | null = null;
const remoteTunnelStates = new Map<string, RemoteTunnelRuntimeState>();
const LOCAL_TARGET_CONNECT_FAILURE_LOG_INTERVAL_MS = 30_000;
const LOCAL_TARGET_CONNECT_FAILURE_CONTEXT_MS = 30_000;
const REVERSE_TUNNEL_STATE_POLL_INTERVAL_MS = 5_000;
const FAVORITE_WORKSPACE_ANALYSIS_FILE = 'favorite-workspaces.analysis.json';
const FAVORITE_LANGUAGE_SCAN_MAX_FILE_BYTES = 1_000_000;
const TOOLBOX_CONFIGURATION_SECTION = 'myToolbox';
const TOOLBOX_CONFIG_FILE_SETTING = 'configFile';
const TOOLBOX_DEBUG_LOGS_SETTING = 'debugLogs';
const DEFAULT_TOOLBOX_CONFIG_FILE = '.vscode/mytoolbox.config.json';
const DEFAULT_CREATED_TOOLBOX_CONFIG_FILE = path.join('.vscode', 'mytoolbox.config.json');

type ProxyState = 'stopped' | 'starting' | 'connected' | 'external' | 'failed';

type RemoteProxyConfig = {
  remoteHost: string;
  remotePort: number;
  remoteUser: string;
  remoteBindPort: number;
  identityFile: string;
};

type FileProxyConfig = {
  sshPath: string;
  connectionReadyDelayMs: number;
  localHost: string;
  localPort: number;
  remotes: RemoteProxyConfig[];
};

type RuntimeRemoteProxyConfig = RemoteProxyConfig & {
  key: string;
  hostLabel: string;
  remoteTarget: string;
  reverseSpec: string;
};

type RuntimeProxyConfig = Omit<FileProxyConfig, 'remotes'> & {
  loadedConfigPath: string;
  remotes: RuntimeRemoteProxyConfig[];
};

type RemoteTunnelRuntimeState = {
  state: ProxyState;
  sshProcess: ChildProcessWithoutNullStreams | null;
  externalPid: number | null;
  connectTimer: NodeJS.Timeout | null;
  stopRequested: boolean;
  lastError: string | null;
  stderrLogState: SshStderrLogState;
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

type BatchedSshKeyProjectResult = {
  configuredRepoName: string;
  repoPath: string;
  remoteUrl: string;
  fetchError: string;
  statusOutput: string;
  error: string;
};

type KeyProjectsViewRow = {
  configuredRepoName: string;
  repoName: string;
  branch: string;
  remoteLabel: string;
  stateLabel: string;
  stateEmoji: string;
  detailTitle: string;
  detailText: string;
  clean: boolean;
  available: boolean;
  loaded: boolean;
};

type KeyProjectsViewModel = {
  issue: string | null;
  configLoaded: boolean;
  refreshing: boolean;
  rows: KeyProjectsViewRow[];
};

type FavoriteWorkspacesConfig = {
  workspaceFiles: string[];
  loadedConfigPath: string;
  configExists: boolean;
};

type FavoriteWorkspaceViewRow = {
  workspacePath: string;
  name: string;
  description: string;
  languageSummary: string;
  languages: FavoriteWorkspaceLanguage[];
  folderSummary: string;
  readmeSummary: string;
  available: boolean;
  error: string | null;
};

type FavoriteWorkspacesViewModel = {
  issue: string | null;
  refreshing: boolean;
  rows: FavoriteWorkspaceViewRow[];
};

type FavoriteWorkspaceLanguage = {
  name: string;
  bytes: number;
  percent: number;
};

type FavoriteWorkspaceAnalysisEntry = {
  updatedAt: string;
  languages: FavoriteWorkspaceLanguage[];
};

type FavoriteWorkspaceAnalysisFile = {
  version: 1;
  workspaces: Record<string, FavoriteWorkspaceAnalysisEntry>;
};

type ToolBoxAction = {
  id: 'bootstrap' | 'logs' | 'proxySettings' | 'keyRefresh';
  label: string;
  enabled: boolean;
};

type BootstrapKeyProjectsConfig = {
  mode: KeyProjectsMode;
  rootDir: string;
  repoNames: string[];
  sshTarget: string;
  sshPort: number;
  gitPath: string;
  sshPath: string;
};

type BootstrapToolBoxConfig = {
  ReverseTunnel: FileProxyConfig;
  keyProjects: BootstrapKeyProjectsConfig;
  favoriteWorkspaces: {
    workspaceFiles: string[];
  };
};

type ToolBoxConfigPathInfo = {
  configPath: string;
  configUri: vscode.Uri;
  hasConfiguredPath: boolean;
};

type ReverseTunnelViewRow = {
  key: string;
  hostLabel: string;
  targetLabel: string;
  bindLabel: string;
  stateLabel: string;
  tone: 'connected' | 'external' | 'starting' | 'failed' | 'stopped';
  tooltip: string;
  action: 'start' | 'stop' | 'none';
  actionLabel: string;
  actionEnabled: boolean;
};

type ReverseTunnelViewModel = {
  stateLabel: string;
  detail: string;
  tone: 'connected' | 'external' | 'starting' | 'failed' | 'stopped';
  actions: ToolBoxAction[];
  issue: string | null;
  rows: ReverseTunnelViewRow[];
};

type ToolBoxViewModel = {
  reverseTunnel: ReverseTunnelViewModel;
  keyProjects: KeyProjectsViewModel;
  favoriteWorkspaces: FavoriteWorkspacesViewModel;
};

type SidebarTestItem = {
  kind: string;
  label: string;
  description?: string;
  tooltip?: string;
  command?: string;
  arguments?: unknown[];
  enabled: boolean;
  parentLabel?: string;
};

type SshStderrLogState = {
  lastLocalTargetConnectFailureLogAt: Map<string, number>;
  localTargetConnectFailureContextUntilMs: number;
};

function isDebugLoggingEnabled(): boolean {
  return vscode.workspace
    .getConfiguration(TOOLBOX_CONFIGURATION_SECTION)
    .get<boolean>(TOOLBOX_DEBUG_LOGS_SETTING, false);
}

function appendDebugLine(message: string): void {
  if (isDebugLoggingEnabled()) {
    outputChannel?.appendLine(`[debug] ${message}`);
  }
}

function getLocalTargetConnectFailureKey(text: string, config: Pick<FileProxyConfig, 'localHost' | 'localPort'>): string | null {
  const hostPattern = new RegExp(`(^|[^\\w.:-])${escapeRegExp(config.localHost)}([^\\w.:-]|$)`, 'i');
  const portPattern = new RegExp(`(^|[^\\d])(?:port\\s+|:)${config.localPort}([^\\d]|$)`, 'i');
  const connectFailurePattern = /connect|connection|refused|failed|no error|连接|无法连接/i;

  if (!hostPattern.test(text) || !portPattern.test(text) || !connectFailurePattern.test(text)) {
    return null;
  }

  return `${config.localHost}:${config.localPort}`;
}

function shouldLogSshStderr(
  text: string,
  config: Pick<FileProxyConfig, 'localHost' | 'localPort'>,
  nowMs: number,
  state: SshStderrLogState
): boolean {
  const localTargetKey = getLocalTargetConnectFailureKey(text, config);
  if (!localTargetKey) {
    if (/^socket:\s*no error$/i.test(text) && nowMs < state.localTargetConnectFailureContextUntilMs) {
      return false;
    }

    return true;
  }

  state.localTargetConnectFailureContextUntilMs = nowMs + LOCAL_TARGET_CONNECT_FAILURE_CONTEXT_MS;

  const lastLoggedAt = state.lastLocalTargetConnectFailureLogAt.get(localTargetKey);
  if (lastLoggedAt !== undefined && nowMs - lastLoggedAt < LOCAL_TARGET_CONNECT_FAILURE_LOG_INTERVAL_MS) {
    return false;
  }

  state.lastLocalTargetConnectFailureLogAt.set(localTargetKey, nowMs);
  return true;
}

function getStateLabel(state: ProxyState): string {
  if (state === 'starting') {
    return 'Starting';
  }
  if (state === 'connected') {
    return 'Started';
  }
  if (state === 'external') {
    return 'Started';
  }
  if (state === 'failed') {
    return 'Failed';
  }
  return 'Stopped';
}

function getReverseTunnelTone(state: ProxyState): ReverseTunnelViewRow['tone'] {
  if (state === 'connected') {
    return 'connected';
  }
  if (state === 'external') {
    return 'external';
  }
  if (state === 'starting') {
    return 'starting';
  }
  if (state === 'failed') {
    return 'failed';
  }
  return 'stopped';
}

function getReverseTunnelActions(): ToolBoxAction[] {
  return [
    {
      id: 'bootstrap',
      label: 'Bootstrap',
      enabled: true
    },
    {
      id: 'logs',
      label: 'Logs',
      enabled: true
    },
    {
      id: 'proxySettings',
      label: 'Settings',
      enabled: true
    }
  ];
}

function getRemoteKey(remote: Pick<RemoteProxyConfig, 'remoteUser' | 'remoteHost' | 'remotePort'>): string {
  return `${remote.remoteUser}@${remote.remoteHost}:${remote.remotePort}`;
}

function createSshStderrLogState(): SshStderrLogState {
  return {
    lastLocalTargetConnectFailureLogAt: new Map<string, number>(),
    localTargetConnectFailureContextUntilMs: 0
  };
}

function getOrCreateRemoteTunnelState(remoteKey: string): RemoteTunnelRuntimeState {
  const existing = remoteTunnelStates.get(remoteKey);
  if (existing) {
    return existing;
  }

  const created: RemoteTunnelRuntimeState = {
    state: 'stopped',
    sshProcess: null,
    externalPid: null,
    connectTimer: null,
    stopRequested: false,
    lastError: null,
    stderrLogState: createSshStderrLogState()
  };
  remoteTunnelStates.set(remoteKey, created);
  return created;
}

function getReverseTunnelAggregateState(rows: ReverseTunnelViewRow[]): ProxyState {
  if (rows.some((row) => row.tone === 'failed')) {
    return 'failed';
  }
  if (rows.some((row) => row.tone === 'starting')) {
    return 'starting';
  }
  if (rows.some((row) => row.tone === 'connected')) {
    return 'connected';
  }
  if (rows.some((row) => row.tone === 'external')) {
    return 'external';
  }
  return 'stopped';
}

function formatRemoteTunnelTooltip(remote: RuntimeRemoteProxyConfig, state: RemoteTunnelRuntimeState): string {
  const isExternal = state.state === 'external';
  const lines = [
    `remote: ${remote.hostLabel}`,
    `target: ${remote.remoteTarget}`,
    `ssh: ${remote.remoteHost}:${remote.remotePort}`,
    `bind: ${remote.remoteBindPort}`,
    `local: ${remote.reverseSpec.split(':').slice(1).join(':')}`,
    `state: ${getStateLabel(state.state)}`,
    `external: ${isExternal ? 'yes' : 'no'}`
  ];

  if (isExternal && state.externalPid) {
    lines.push(`Started externally, pid=${state.externalPid}`);
  } else if (isExternal) {
    lines.push('Started externally');
  } else if (state.sshProcess?.pid) {
    lines.push(`pid: ${state.sshProcess.pid}`);
  }
  if (state.lastError) {
    lines.push(`error: ${state.lastError}`);
  }

  return lines.join('\n');
}

async function getReverseTunnelViewModel(): Promise<ReverseTunnelViewModel> {
  let config: RuntimeProxyConfig;
  try {
    config = await getConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      stateLabel: 'Config Error',
      detail: message,
      tone: 'failed',
      actions: getReverseTunnelActions(),
      issue: message,
      rows: []
    };
  }

  const rows: ReverseTunnelViewRow[] = config.remotes.map((remote) => {
    const state = getOrCreateRemoteTunnelState(remote.key);
    const isManagedStarted = state.state === 'connected' || state.state === 'starting';
    const action: ReverseTunnelViewRow['action'] = state.state === 'stopped' || state.state === 'failed' ? 'start' : isManagedStarted ? 'stop' : 'none';
    const actionLabel = action === 'start' ? 'Start' : action === 'stop' ? 'Stop' : '-';
    return {
      key: remote.key,
      hostLabel: remote.hostLabel,
      targetLabel: remote.remoteTarget,
      bindLabel: String(remote.remoteBindPort),
      stateLabel: getStateLabel(state.state),
      tone: getReverseTunnelTone(state.state),
      tooltip: formatRemoteTunnelTooltip(remote, state),
      action,
      actionLabel,
      actionEnabled: action !== 'none' && state.state !== 'starting'
    };
  });

  const aggregateState = getReverseTunnelAggregateState(rows);
  const startedCount = rows.filter((row) => row.tone === 'connected' || row.tone === 'external').length;
  return {
    stateLabel: `${startedCount}/${rows.length} Started`,
    detail: `${rows.length} reverse tunnel remote${rows.length === 1 ? '' : 's'} configured.`,
    tone: getReverseTunnelTone(aggregateState),
    actions: getReverseTunnelActions(),
    issue: null,
    rows
  };
}

function getKeyProjectStateLabel(status: Pick<KeyProjectStatus, 'clean' | 'available'>): string {
  if (!status.available) {
    return 'unavailable';
  }

  return status.clean ? 'clean' : 'dirty';
}

function getKeyProjectStateEmoji(status: Pick<KeyProjectStatus, 'clean' | 'available'>): string {
  if (!status.available) {
    return '\u26A0';
  }

  return status.clean ? '\u2714\uFE0F' : '\u2757';
}

async function getKeyProjectsViewModel(): Promise<KeyProjectsViewModel> {
  let config: KeyProjectsConfig;
  try {
    config = await getKeyProjectsConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      issue: message,
      configLoaded: false,
      refreshing: Boolean(keyProjectsRefreshPromise),
      rows: []
    };
  }
  const issue = getKeyProjectsConfigurationIssue(config);
  const cached = issue ? null : getCachedKeyProjectStatuses(config);
  const statuses = cached ?? [];
  const rows = statuses.length > 0
    ? statuses.map((status) => ({
      configuredRepoName: status.configuredRepoName,
      repoName: status.repoName,
      branch: status.available ? status.branch : 'unavailable',
      remoteLabel: status.available ? getKeyProjectSyncLabel(status) : 'unavailable',
      stateLabel: getKeyProjectStateLabel(status),
      stateEmoji: getKeyProjectStateEmoji(status),
      detailTitle: status.repoName + ' - ' + status.branch,
      detailText: formatKeyProjectCachedDetail(status),
      clean: status.clean,
      available: status.available,
      loaded: true
    }))
    : issue
      ? []
      : config.repoNames.map((repoName) => ({
        configuredRepoName: repoName,
        repoName,
        branch: '',
        remoteLabel: '',
        stateLabel: 'not loaded',
        stateEmoji: '',
        detailTitle: repoName,
        detailText: 'Status not loaded. Click Refresh first.',
        clean: false,
        available: true,
        loaded: false
      }));

  return {
    issue,
    configLoaded: Boolean(cached),
    refreshing: Boolean(keyProjectsRefreshPromise),
    rows
  };
}

async function getToolBoxViewModel(): Promise<ToolBoxViewModel> {
  return {
    reverseTunnel: await getReverseTunnelViewModel(),
    keyProjects: await getKeyProjectsViewModel(),
    favoriteWorkspaces: await getFavoriteWorkspacesViewModel()
  };
}


async function getPinnedProjectDetailForWebview(repoName: string): Promise<{ title: string; text: string }> {
  const config = await getKeyProjectsConfig();
  const cachedStatus = getCachedKeyProjectStatuses(config)?.find((entry) => entry.configuredRepoName === repoName);
  const repoPath = getRepoPath(config.rootDir, repoName, config.mode);
  const displayName = await loadRepoDisplayName(config, repoPath);
  const detailStatus = cachedStatus ?? {
    configuredRepoName: repoName,
    repoName: displayName,
    repoPath,
    branch: 'unknown',
    syncState: 'unknown' as const,
    aheadCount: 0,
    behindCount: 0,
    shortStatus: '',
    clean: false,
    available: false,
    error: 'Status not loaded. Click Refresh first.'
  };

  return {
    title: detailStatus.repoName + ' - ' + detailStatus.branch,
    text: formatKeyProjectCachedDetail(detailStatus)
  };
}

function setRemoteTunnelState(remoteKey: string, state: ProxyState): void {
  const remoteState = getOrCreateRemoteTunnelState(remoteKey);
  remoteState.state = state;
  void toolBoxWebviewProvider?.refresh();
}

async function getReverseTunnelSidebarItemsForTest(): Promise<SidebarTestItem[]> {
  let config: RuntimeProxyConfig;
  try {
    config = await getConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        kind: 'info',
        label: message,
        tooltip: message,
        enabled: false,
        parentLabel: 'ReverseTunnel'
      },
      {
        kind: 'action',
        label: 'Open Logs',
        command: 'reverseProxy.showLogs',
        enabled: true,
        parentLabel: 'ReverseTunnel'
      },
      {
        kind: 'action',
        label: 'Settings',
        command: 'reverseProxy.openSettings',
        enabled: true,
        parentLabel: 'ReverseTunnel'
      }
    ];
  }

  const remoteItems = config.remotes.map((remote) => {
    const state = getOrCreateRemoteTunnelState(remote.key);
    const isManagedStarted = state.state === 'connected' || state.state === 'starting';
    const command = state.state === 'stopped' || state.state === 'failed'
      ? 'reverseProxy.test.startRemoteTunnel'
      : isManagedStarted
        ? 'reverseProxy.test.stopRemoteTunnel'
        : undefined;
    return {
      kind: 'remote',
      label: `${remote.hostLabel}: ${getStateLabel(state.state)}`,
      description: state.state === 'external' ? 'external' : undefined,
      tooltip: formatRemoteTunnelTooltip(remote, state),
      command,
      arguments: command ? [remote.key] : undefined,
      enabled: Boolean(command) && state.state !== 'starting',
      parentLabel: 'ReverseTunnel'
    };
  });

  return [
    ...remoteItems,
    {
      kind: 'action',
      label: 'Open Logs',
      command: 'reverseProxy.showLogs',
      enabled: true,
      parentLabel: 'ReverseTunnel'
    },
    {
      kind: 'action',
      label: 'Settings',
      command: 'reverseProxy.openSettings',
      enabled: true,
      parentLabel: 'ReverseTunnel'
    }
  ];
}

async function getKeyProjectSidebarItemsForTest(): Promise<SidebarTestItem[]> {
  let config: KeyProjectsConfig;
  let issue: string | null = null;
  try {
    config = await getKeyProjectsConfig();
    issue = getKeyProjectsConfigurationIssue(config);
  } catch (error) {
    issue = error instanceof Error ? error.message : String(error);
    config = {
      mode: 'local',
      rootDir: '',
      repoNames: [],
      sshTarget: '',
      sshPort: 22,
      gitPath: 'git',
      sshPath: 'ssh',
      loadedConfigPath: '<invalid>',
      configExists: false,
      workspaceAvailable: true
    };
  }
  const items: SidebarTestItem[] = [];

  if (issue) {
    items.push({
      kind: 'info',
      label: issue,
      tooltip: issue,
      enabled: false,
      parentLabel: 'Pinned Projects'
    });
  } else {
    const cached = getCachedKeyProjectStatuses(config);
    if (cached) {
      for (const status of cached) {
        const label = status.available
          ? (status.clean
              ? `\u2714\uFE0F ${status.repoName}: ${status.branch} - ${getKeyProjectSyncLabel(status)}`
              : `\u2757 ${status.repoName}: ${status.branch} - ${getKeyProjectSyncLabel(status)}`)
          : `\u26A0 ${status.repoName}: unavailable`;
        items.push({
          kind: 'project',
          label,
          tooltip: formatKeyProjectTooltip(status).value,
          command: 'reverseProxy.showKeyProjectStatus',
          arguments: [status.configuredRepoName],
          enabled: true,
          parentLabel: 'Pinned Projects'
        });
      }
    } else {
      for (const repoName of config.repoNames) {
        items.push({
          kind: 'project',
          label: repoName,
          tooltip: 'Status not loaded. Click Refresh first.',
          command: 'reverseProxy.showKeyProjectStatus',
          arguments: [repoName],
          enabled: true,
          parentLabel: 'Pinned Projects'
        });
      }
    }
  }

  items.push({
    kind: 'action',
    label: keyProjectsRefreshPromise ? 'Refreshing...' : 'Refresh',
    command: keyProjectsRefreshPromise ? undefined : 'reverseProxy.refreshKeyProjects',
    enabled: !keyProjectsRefreshPromise,
    parentLabel: 'Pinned Projects'
  });
  return items;
}

async function getSidebarItemsForTest(): Promise<{ root: SidebarTestItem[]; children: SidebarTestItem[] }> {
  return {
    root: [
      { kind: 'group', label: 'ReverseTunnel', enabled: false },
      { kind: 'group', label: 'Pinned Projects', enabled: false }
    ],
    children: [...(await getReverseTunnelSidebarItemsForTest()), ...(await getKeyProjectSidebarItemsForTest())]
  };
}

async function setKeyProjectsWorkspaceOverrideForTest(workspacePath?: string | null): Promise<string | null> {
  keyProjectsWorkspaceOverride = workspacePath ?? null;
  void toolBoxWebviewProvider?.refresh();
  return keyProjectsWorkspaceOverride;
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
  void workspacePath;
  const { configPath, configUri } = getConfiguredConfigFileRef();

  let parsed: Record<string, unknown> | null = null;

  try {
    const rawText = await readConfigText(configUri);
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
    loadedConfigPath: configPath,
    configExists: Boolean(parsed),
    workspaceAvailable: true
  };

  appendDebugLine(
    `[key-projects] config path=${result.loadedConfigPath} exists=${result.configExists} mode=${result.mode} rootDir=${result.rootDir || '<empty>'} repos=${result.repoNames.join(', ') || '<none>'} sshTarget=${result.sshTarget || '<empty>'} sshPort=${result.sshPort}`
  );

  return result;
}

async function readToolBoxConfigRoot(configPath: string, allowMissing: boolean): Promise<Record<string, unknown> | null> {
  const configUri = getToolBoxConfigUriFromPath(configPath);

  try {
    const rawText = await readConfigText(configUri);
    const raw = JSON.parse(rawText) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Invalid config file '${configUri.toString()}': root must be a JSON object.`);
    }
    return raw as Record<string, unknown>;
  } catch (error) {
    if (allowMissing && isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function resolvePathFromConfigDir(configPath: string, value: string): string {
  const trimmed = value.trim();
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }
  return path.normalize(path.resolve(path.dirname(configPath), trimmed));
}

async function getFavoriteWorkspacesConfig(): Promise<FavoriteWorkspacesConfig> {
  const { configPath } = getConfiguredConfigFileRef();
  const parsed = await readToolBoxConfigRoot(configPath, true);
  const section =
    parsed && parsed.favoriteWorkspaces && typeof parsed.favoriteWorkspaces === 'object' && !Array.isArray(parsed.favoriteWorkspaces)
      ? (parsed.favoriteWorkspaces as Record<string, unknown>)
      : {};

  return {
    workspaceFiles: assertStringArray(section.workspaceFiles ?? [], 'favoriteWorkspaces.workspaceFiles')
      .map((entry) => resolvePathFromConfigDir(configPath, entry)),
    loadedConfigPath: configPath,
    configExists: Boolean(parsed)
  };
}

function getWorkspaceFolderDisplayName(folder: unknown, workspaceFilePath: string): string | null {
  if (!folder || typeof folder !== 'object' || Array.isArray(folder)) {
    return null;
  }
  const data = folder as Record<string, unknown>;
  if (typeof data.name === 'string' && data.name.trim()) {
    return data.name.trim();
  }
  if (typeof data.path === 'string' && data.path.trim()) {
    return path.basename(resolveWorkspaceFolderPath(workspaceFilePath, data.path.trim()));
  }
  if (typeof data.uri === 'string' && data.uri.trim()) {
    try {
      const uri = vscode.Uri.parse(data.uri.trim());
      return path.basename(uri.fsPath || uri.path);
    } catch {
      return path.basename(data.uri.trim());
    }
  }
  return null;
}

function resolveWorkspaceFolderPath(workspaceFilePath: string, folderPath: string): string {
  if (path.isAbsolute(folderPath)) {
    return folderPath;
  }
  return path.resolve(path.dirname(workspaceFilePath), folderPath);
}

function getWorkspaceFolderUris(folders: unknown, workspaceFilePath: string): vscode.Uri[] {
  if (!Array.isArray(folders)) {
    return [];
  }
  return folders
    .map((folder) => {
      if (!folder || typeof folder !== 'object' || Array.isArray(folder)) {
        return null;
      }
      const data = folder as Record<string, unknown>;
      if (typeof data.path === 'string' && data.path.trim()) {
        return vscode.Uri.file(resolveWorkspaceFolderPath(workspaceFilePath, data.path.trim()));
      }
      if (typeof data.uri === 'string' && data.uri.trim()) {
        try {
          return vscode.Uri.parse(data.uri.trim());
        } catch {
          return null;
        }
      }
      return null;
    })
    .filter((entry): entry is vscode.Uri => Boolean(entry));
}

function createFolderSummary(folders: unknown, workspaceFilePath: string): string {
  if (!Array.isArray(folders) || folders.length === 0) {
    return '';
  }
  const names = folders
    .map((folder) => getWorkspaceFolderDisplayName(folder, workspaceFilePath))
    .filter((entry): entry is string => Boolean(entry));
  if (names.length === 0) {
    return '';
  }
  return [
    ...names.slice(0, 2),
    ...(names.length > 2 ? [`+${names.length - 2} more`] : [])
  ].join(', ');
}

const FAVORITE_LANGUAGE_BY_EXTENSION = new Map<string, string>([
  ['.ts', 'TypeScript'],
  ['.tsx', 'TypeScript'],
  ['.js', 'JavaScript'],
  ['.jsx', 'JavaScript'],
  ['.mjs', 'JavaScript'],
  ['.cjs', 'JavaScript'],
  ['.py', 'Python'],
  ['.rs', 'Rust'],
  ['.cpp', 'C++'],
  ['.cc', 'C++'],
  ['.cxx', 'C++'],
  ['.hpp', 'C++'],
  ['.hh', 'C++'],
  ['.hxx', 'C++'],
  ['.h', 'C++'],
  ['.c', 'C'],
  ['.go', 'Go'],
  ['.java', 'Java'],
  ['.cs', 'C#'],
  ['.kt', 'Kotlin'],
  ['.kts', 'Kotlin'],
  ['.swift', 'Swift'],
  ['.php', 'PHP'],
  ['.rb', 'Ruby'],
  ['.sh', 'Shell'],
  ['.bash', 'Shell'],
  ['.zsh', 'Shell'],
  ['.ps1', 'PowerShell'],
  ['.html', 'HTML'],
  ['.css', 'CSS'],
  ['.scss', 'SCSS'],
  ['.vue', 'Vue'],
  ['.svelte', 'Svelte'],
  ['.dart', 'Dart'],
  ['.scala', 'Scala'],
  ['.lua', 'Lua'],
  ['.r', 'R'],
  ['.jl', 'Julia']
]);

const FAVORITE_LANGUAGE_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.venv',
  '__pycache__'
]);

const FAVORITE_LANGUAGE_IGNORED_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'cargo.lock',
  'composer.lock'
]);

const FAVORITE_LANGUAGE_IGNORED_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.zip',
  '.gz',
  '.tgz',
  '.rar',
  '.7z',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.lock',
  '.map'
]);

function formatFavoriteWorkspaceLanguageSummary(languages: FavoriteWorkspaceLanguage[]): string {
  return languages
    .slice(0, 2)
    .map((entry) => `${entry.name} ${entry.percent}%`)
    .join(' · ');
}

function getFavoriteWorkspaceAnalysisUri(): vscode.Uri {
  if (!extensionContextRef) {
    throw new Error('Extension context is not initialized.');
  }
  return vscode.Uri.joinPath(extensionContextRef.globalStorageUri, FAVORITE_WORKSPACE_ANALYSIS_FILE);
}

async function readFavoriteWorkspaceAnalysisFile(): Promise<FavoriteWorkspaceAnalysisFile> {
  const uri = getFavoriteWorkspaceAnalysisUri();
  try {
    const raw = JSON.parse(await readConfigText(uri)) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('favorite workspace analysis root must be an object');
    }
    const data = raw as { version?: unknown; workspaces?: unknown };
    const workspaces = data.workspaces && typeof data.workspaces === 'object' && !Array.isArray(data.workspaces)
      ? data.workspaces as Record<string, FavoriteWorkspaceAnalysisEntry>
      : {};
    return { version: 1, workspaces };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return { version: 1, workspaces: {} };
    }
    throw error;
  }
}

async function writeFavoriteWorkspaceAnalysisFile(data: FavoriteWorkspaceAnalysisFile): Promise<void> {
  const uri = getFavoriteWorkspaceAnalysisUri();
  if (!extensionContextRef) {
    throw new Error('Extension context is not initialized.');
  }
  await vscode.workspace.fs.createDirectory(extensionContextRef.globalStorageUri);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8'));
}

function getFavoriteWorkspaceAnalysisKey(workspacePath: string): string {
  return path.normalize(workspacePath);
}

async function getFavoriteWorkspaceAnalysis(workspacePath: string): Promise<FavoriteWorkspaceAnalysisEntry | null> {
  const cache = await readFavoriteWorkspaceAnalysisFile();
  return cache.workspaces[getFavoriteWorkspaceAnalysisKey(workspacePath)] ?? null;
}

async function scanFavoriteWorkspaceLanguages(workspacePath: string): Promise<FavoriteWorkspaceLanguage[]> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(workspacePath));
  const raw = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('workspace file root must be a JSON object');
  }

  const folderUris = getWorkspaceFolderUris((raw as Record<string, unknown>).folders, workspacePath);
  const languageBytes = new Map<string, number>();
  for (const folderUri of folderUris) {
    await scanFavoriteWorkspaceFolder(folderUri, languageBytes);
  }

  const totalBytes = Array.from(languageBytes.values()).reduce((sum, value) => sum + value, 0);
  if (totalBytes <= 0) {
    return [];
  }

  return Array.from(languageBytes.entries())
    .map(([name, bytes]) => ({
      name,
      bytes,
      percent: Math.max(1, Math.round((bytes / totalBytes) * 100))
    }))
    .sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name))
    .slice(0, 2);
}

async function scanFavoriteWorkspaceFolder(folderUri: vscode.Uri, languageBytes: Map<string, number>): Promise<void> {
  let entries: Array<[string, vscode.FileType]>;
  try {
    entries = await vscode.workspace.fs.readDirectory(folderUri);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      outputChannel?.appendLine(`[favorite-workspaces] failed to scan '${folderUri.toString()}': ${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  for (const [entryName, entryType] of entries) {
    const entryUri = vscode.Uri.joinPath(folderUri, entryName);
    if ((entryType & vscode.FileType.Directory) !== 0) {
      if (!FAVORITE_LANGUAGE_IGNORED_DIRS.has(entryName.toLowerCase())) {
        await scanFavoriteWorkspaceFolder(entryUri, languageBytes);
      }
      continue;
    }
    if ((entryType & vscode.FileType.File) === 0) {
      continue;
    }

    const extension = path.extname(entryName).toLowerCase();
    if (FAVORITE_LANGUAGE_IGNORED_FILES.has(entryName.toLowerCase()) || FAVORITE_LANGUAGE_IGNORED_EXTENSIONS.has(extension)) {
      continue;
    }

    const language = FAVORITE_LANGUAGE_BY_EXTENSION.get(extension);
    if (!language) {
      continue;
    }

    try {
      const stat = await vscode.workspace.fs.stat(entryUri);
      if (stat.size <= 0 || stat.size > FAVORITE_LANGUAGE_SCAN_MAX_FILE_BYTES) {
        continue;
      }
      languageBytes.set(language, (languageBytes.get(language) ?? 0) + stat.size);
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        outputChannel?.appendLine(`[favorite-workspaces] failed to stat '${entryUri.toString()}': ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

async function refreshFavoriteWorkspaceAnalysis(workspacePaths: string[]): Promise<void> {
  const cache = await readFavoriteWorkspaceAnalysisFile();
  const activeKeys = new Set(workspacePaths.map(getFavoriteWorkspaceAnalysisKey));
  for (const key of Object.keys(cache.workspaces)) {
    if (!activeKeys.has(key)) {
      delete cache.workspaces[key];
    }
  }

  for (const workspacePath of workspacePaths) {
    try {
      const normalized = getFavoriteWorkspaceAnalysisKey(workspacePath);
      cache.workspaces[normalized] = {
        updatedAt: new Date().toISOString(),
        languages: await scanFavoriteWorkspaceLanguages(workspacePath)
      };
    } catch (error) {
      outputChannel?.appendLine(`[favorite-workspaces] failed to analyze '${workspacePath}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await writeFavoriteWorkspaceAnalysisFile(cache);
}

async function getFavoriteWorkspaceRow(workspacePath: string): Promise<FavoriteWorkspaceViewRow> {
  const name = path.basename(workspacePath, '.code-workspace');
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(workspacePath));
    const raw = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('workspace file root must be a JSON object');
    }
    const data = raw as Record<string, unknown>;
    const folderSummary = createFolderSummary(data.folders, workspacePath);
    const analysis = await getFavoriteWorkspaceAnalysis(workspacePath);
    const languageSummary = formatFavoriteWorkspaceLanguageSummary(analysis?.languages ?? []);
    const description = [folderSummary, languageSummary].filter(Boolean).join(' | ');
    return {
      workspacePath,
      name,
      description,
      languageSummary,
      languages: analysis?.languages ?? [],
      folderSummary,
      readmeSummary: '',
      available: true,
      error: null
    };
  } catch (error) {
    return {
      workspacePath,
      name,
      description: '',
      languageSummary: '',
      languages: [],
      folderSummary: '',
      readmeSummary: '',
      available: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function getFavoriteWorkspacesViewModel(): Promise<FavoriteWorkspacesViewModel> {
  try {
    const config = await getFavoriteWorkspacesConfig();
    if (!config.configExists) {
      return {
        issue: null,
        refreshing: Boolean(favoriteWorkspacesRefreshPromise),
        rows: []
      };
    }
    return {
      issue: null,
      refreshing: Boolean(favoriteWorkspacesRefreshPromise),
      rows: await Promise.all(config.workspaceFiles.map((workspacePath) => getFavoriteWorkspaceRow(workspacePath)))
    };
  } catch (error) {
    return {
      issue: error instanceof Error ? error.message : String(error),
      refreshing: Boolean(favoriteWorkspacesRefreshPromise),
      rows: []
    };
  }
}

function getKeyProjectsConfigurationIssue(config: KeyProjectsConfig): string | null {
  if (!config.configExists) {
    return 'Create the ToolBox config file to list key projects.';
  }

  if (!config.rootDir) {
    return 'Set keyProjects.rootDir in the ToolBox config file.';
  }

  if (config.mode === 'ssh' && !config.sshTarget) {
    return 'Set keyProjects.sshTarget in the ToolBox config file when mode is ssh.';
  }

  return null;
}

async function openKeyProjectsSettings(workspacePath?: string): Promise<string> {
  void workspacePath;
  const openedPath = await openSettingsConfig();
  if (!openedPath) {
    throw new Error('ToolBox config file was not opened.');
  }
  return openedPath;
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

function runCommandWithInput(command: string, args: string[], input: string | undefined, timeoutMs = 8000): Promise<string> {
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

    child.stdin.on('error', () => {
      // Ignore broken pipe errors when the remote process exits early.
    });
    if (typeof input === 'string') {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

function runCommand(command: string, args: string[], timeoutMs = 8000): Promise<string> {
  return runCommandWithInput(command, args, undefined, timeoutMs);
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

async function loadKeyProjectStatusesFromBatchedSsh(config: KeyProjectsConfig): Promise<KeyProjectStatus[]> {
  const token = getRemoteKeyProjectsBatchToken();
  const remoteScriptPath = getRemoteKeyProjectsScriptPath(token);
  const remoteRunDir = getRemoteKeyProjectsRunDir(token);
  const script = buildRemoteKeyProjectsBatchScript(config, remoteRunDir);
  const bootstrapScript = buildRemoteKeyProjectsBootstrapScript(script);
  appendDebugLine(`[key-projects] batched ssh script=${remoteScriptPath} runDir=${remoteRunDir}`);

  const output = await runCommandWithInput(
    config.sshPath,
    config.sshPort === 22
      ? [config.sshTarget, buildRemoteKeyProjectsBootstrapCommand(remoteScriptPath, remoteRunDir)]
      : ['-p', String(config.sshPort), config.sshTarget, buildRemoteKeyProjectsBootstrapCommand(remoteScriptPath, remoteRunDir)],
    bootstrapScript,
    Math.max(20000, config.repoNames.length * 8000)
  );
  const parsedResults = parseBatchedSshKeyProjectResults(output);

  return config.repoNames.map((repoName) => {
    const repoPath = getRepoPath(config.rootDir, repoName, config.mode);
    const parsedResult = parsedResults.get(repoName);

    if (!parsedResult) {
      return {
        configuredRepoName: repoName,
        repoName: getRepoDisplayName(repoPath, config.mode),
        repoPath,
        branch: 'unknown',
        syncState: 'unknown' as const,
        aheadCount: 0,
        behindCount: 0,
        shortStatus: '',
        clean: false,
        available: false,
        error: 'Missing batched SSH result.'
      };
    }

    const displayName = parseRemoteRepoName(parsedResult.remoteUrl, getRepoDisplayName(parsedResult.repoPath || repoPath, config.mode));

    if (parsedResult.error) {
      outputChannel?.appendLine(`[key-projects] failed repo=${repoName}: ${parsedResult.error}`);
      return {
        configuredRepoName: repoName,
        repoName: displayName,
        repoPath: parsedResult.repoPath || repoPath,
        branch: 'unknown',
        syncState: 'unknown' as const,
        aheadCount: 0,
        behindCount: 0,
        shortStatus: '',
        clean: false,
        available: false,
        error: parsedResult.error
      };
    }

    const parsedStatus = parseGitStatusSummary(parsedResult.statusOutput.trimEnd());

    if (parsedResult.fetchError) {
      outputChannel?.appendLine(`[key-projects] fetch warning repo=${repoName}: ${parsedResult.fetchError}`);
    }

    return {
      configuredRepoName: repoName,
      repoName: displayName,
      repoPath: parsedResult.repoPath || repoPath,
      branch: parsedStatus.branch,
      upstream: parsedStatus.upstream,
      syncState: parsedResult.fetchError ? 'unknown' : parsedStatus.syncState,
      aheadCount: parsedStatus.aheadCount,
      behindCount: parsedStatus.behindCount,
      shortStatus: parsedStatus.shortStatus,
      clean: parsedStatus.clean,
      available: true,
      fetchError: parsedResult.fetchError || undefined
    };
  });
}

async function loadKeyProjectStatuses(config: KeyProjectsConfig): Promise<KeyProjectStatus[]> {
  appendDebugLine(`[key-projects] refresh start count=${config.repoNames.length}`);
  if (config.mode === 'ssh') {
    try {
      return await loadKeyProjectStatusesFromBatchedSsh(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputChannel?.appendLine(`[key-projects] batched ssh refresh failed: ${message}`);
      outputChannel?.appendLine('[key-projects] falling back to per-repo ssh refresh.');
    }
  }

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
      void toolBoxWebviewProvider?.refresh();
      return;
    }

    const statuses = await loadKeyProjectStatuses(config);
    setCachedKeyProjectStatuses(config, statuses);
    appendDebugLine(`[key-projects] refresh complete count=${statuses.length}`);
    void toolBoxWebviewProvider?.refresh();
  })();

  void toolBoxWebviewProvider?.refresh();

  try {
    await keyProjectsRefreshPromise;
  } finally {
    keyProjectsRefreshPromise = null;
    void toolBoxWebviewProvider?.refresh();
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

function formatKeyProjectCachedDetail(status: KeyProjectStatus): string {
  const lines = [
    'Repo: ' + status.repoName,
    'Path: ' + status.repoPath,
    'Branch: ' + status.branch,
    'Upstream: ' + (status.upstream ?? 'not configured'),
    'Remote Sync: ' + getKeyProjectSyncLabel(status),
    'Fetch: ' + (status.fetchError ? 'failed (' + status.fetchError + ')' : 'ok'),
    'Status: ' + (status.available ? (status.clean ? 'clean' : 'dirty') : 'unavailable')
  ];

  if (!status.available) {
    lines.push('Error: ' + (status.error ?? 'Unavailable'));
    return lines.join('\n');
  }

  if (status.clean) {
    lines.push('Changes: working tree clean');
  } else {
    lines.push('Changes:');
    for (const entry of status.shortStatus.split('\n').filter((line) => line.trim().length > 0)) {
      lines.push(entry);
    }
  }

  return lines.join('\n');
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
  appendDebugLine(`[key-projects] showing detailed status for repo=${repoName} display=${status.repoName}`);
  outputChannel.appendLine(text);
  outputChannel.show(true);
  return text;
}

function resolveConfiguredConfigPathWithContext(configFile: string, options?: ResolvePathOptions): string {
  return resolveConfiguredConfigPathWithContextCore(configFile, {
    workspaceFolder: options?.workspaceFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    remoteName: options?.remoteName ?? vscode.env.remoteName,
    homeDir: options?.homeDir ?? os.homedir(),
    extensionPath: options?.extensionPath ?? extensionContextRef?.extensionPath
  });
}

function resolveConfigPathWithContext(configFile: string, options?: ResolvePathOptions): string {
  return resolveConfigPathWithContextCore(configFile, {
    workspaceFolder: options?.workspaceFolder ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    remoteName: options?.remoteName ?? vscode.env.remoteName,
    homeDir: options?.homeDir ?? os.homedir(),
    extensionPath: options?.extensionPath ?? extensionContextRef?.extensionPath
  });
}

function resolveConfigPath(configFile: string): string {
  return resolveConfigPathWithContext(configFile);
}

function resolveConfiguredConfigPath(configFile: string): string {
  return resolveConfiguredConfigPathWithContext(configFile);
}

function getConfiguredConfigUri(configFile: string): vscode.Uri {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceTokenMatch = configFile.match(/^\$\{workspace(?:Folder|Root)\}(?:[\\/](.*))?$/i);
  if (workspaceTokenMatch) {
    if (!workspaceFolder) {
      throw new Error('Workspace folder is required to resolve ${workspaceFolder} in config path.');
    }
    const relativePath = workspaceTokenMatch[1] ?? '';
    return relativePath
      ? vscode.Uri.joinPath(workspaceFolder.uri, ...relativePath.split(/[\\/]+/).filter(Boolean))
      : workspaceFolder.uri;
  }

  if (path.isAbsolute(configFile)) {
    return vscode.Uri.file(configFile);
  }

  if (workspaceFolder) {
    return vscode.Uri.joinPath(workspaceFolder.uri, ...configFile.split(/[\\/]+/).filter(Boolean));
  }

  return vscode.Uri.file(path.join(os.homedir(), configFile));
}

function getConfiguredConfigFileRef(): { configPath: string; configUri: vscode.Uri } {
  const config = vscode.workspace.getConfiguration(TOOLBOX_CONFIGURATION_SECTION);
  const configFile = config.get<string>(TOOLBOX_CONFIG_FILE_SETTING, DEFAULT_TOOLBOX_CONFIG_FILE);
  const configUri = getConfiguredConfigUri(configFile);
  return {
    configPath: normalizeDisplayFsPath(configUri.fsPath) || configUri.toString(),
    configUri
  };
}

function normalizeDisplayFsPath(fsPath: string): string {
  return fsPath.replace(/^([a-z]):/, (match, drive: string) => `${drive.toUpperCase()}:`);
}

async function readConfigText(configUri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(configUri);
  return Buffer.from(bytes).toString('utf8');
}

function getToolBoxConfigUriFromPath(configPath: string): vscode.Uri {
  const current = getConfiguredConfigFileRef();
  if (current.configPath === configPath) {
    return current.configUri;
  }
  return vscode.Uri.file(configPath);
}

async function configFileExists(configUri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(configUri);
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function getConfig(): Promise<RuntimeProxyConfig> {
  const { configPath, configUri } = getConfiguredConfigFileRef();
  try {
    return getRuntimeProxyConfigFromFileConfig(
      parseFileProxyConfigContent(await readConfigText(configUri), configUri.toString()),
      configPath
    );
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new Error(`Config file not found: ${configUri.toString()}`);
    }
    throw error;
  }
}

function verifySshExists(sshPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = spawn(sshPath, ['-V']);

    const onData = (data: Buffer) => {
      appendDebugLine(`[ssh-check] ${data.toString().trim()}`);
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

function isMatchingTunnelCommand(commandLine: string, remote: RuntimeRemoteProxyConfig): boolean {
  const normalized = normalizeCommandLine(commandLine);
  if (!normalized) {
    return false;
  }

  const reverseSpecLower = remote.reverseSpec.toLowerCase();
  const normalizedLower = normalized.toLowerCase();

  const hasReverseFlag = /(^|\s)-R(?=\s|$)/i.test(normalized);
  const hasReverseSpec = normalizedLower.includes(reverseSpecLower);
  if (!hasReverseFlag || !hasReverseSpec) {
    return false;
  }

  const hasRemoteTarget =
    commandLineHasArg(normalized, remote.remoteTarget) ||
    (commandLineHasArg(normalized, remote.remoteHost) && commandLineHasArg(normalized, remote.remoteUser));

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

async function findExistingTunnelProcess(remote: RuntimeRemoteProxyConfig, processes?: ExistingTunnelMatch[]): Promise<ExistingTunnelMatch | null> {
  const candidates = processes ?? (await listCandidateProcesses());
  const currentPid = process.pid;
  const state = getOrCreateRemoteTunnelState(remote.key);

  for (const candidate of candidates) {
    if (candidate.pid === currentPid) {
      continue;
    }
    if (state.sshProcess?.pid && candidate.pid === state.sshProcess.pid) {
      return candidate;
    }
    if (isMatchingTunnelCommand(candidate.commandLine, remote)) {
      return candidate;
    }
  }

  return null;
}

async function syncProxyStateFromSystem(config?: RuntimeProxyConfig): Promise<boolean> {
  let runtimeConfig = config;
  if (!runtimeConfig) {
    try {
      runtimeConfig = await getConfig();
    } catch {
      return false;
    }
  }

  try {
    const processes = await listCandidateProcesses();
    let foundAny = false;
    for (const remote of runtimeConfig.remotes) {
      const state = getOrCreateRemoteTunnelState(remote.key);
      const existing = await findExistingTunnelProcess(remote, processes);
      if (!existing) {
        state.externalPid = null;
        if (!state.sshProcess && (state.state === 'connected' || state.state === 'external')) {
          setRemoteTunnelState(remote.key, 'stopped');
        }
        continue;
      }

      foundAny = true;
      if (state.sshProcess?.pid === existing.pid) {
        state.externalPid = null;
      } else {
        state.externalPid = existing.pid;
        if (state.state !== 'external') {
          appendDebugLine(`[sync] detected external reverse tunnel remote=${remote.key} pid=${existing.pid}`);
          setRemoteTunnelState(remote.key, 'external');
        }
      }
    }
    return foundAny;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[warn] unable to inspect existing tunnel processes: ${message}`);
    return false;
  }
}

function getRuntimeRemote(config: RuntimeProxyConfig, remoteKey: string): RuntimeRemoteProxyConfig | null {
  return config.remotes.find((remote) => remote.key === remoteKey) ?? null;
}

async function startRemoteTunnel(remoteKey: string): Promise<void> {
  let config: RuntimeProxyConfig;
  try {
    config = await getConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[error] ${message}`);
    vscode.window.showErrorMessage(`Failed to load reverse proxy config: ${message}`);
    return;
  }

  const remote = getRuntimeRemote(config, remoteKey);
  if (!remote) {
    vscode.window.showErrorMessage(`Reverse tunnel remote not found: ${remoteKey}`);
    return;
  }

  const state = getOrCreateRemoteTunnelState(remote.key);
  if (state.sshProcess || state.state === 'starting' || state.state === 'connected') {
    vscode.window.showInformationMessage(`Reverse tunnel is already started: ${remote.hostLabel}`);
    return;
  }
  if (state.state === 'external') {
    vscode.window.showInformationMessage(`Reverse tunnel is already started externally: ${remote.hostLabel}`);
    return;
  }

  appendDebugLine(`[config] using file: ${config.loadedConfigPath}`);
  if (vscode.env.remoteName) {
    appendDebugLine(`[mode] workspace is remote (${vscode.env.remoteName}), tunnel runs on local UI host.`);
  }

  await syncProxyStateFromSystem(config);
  const syncedState = getOrCreateRemoteTunnelState(remote.key);
  if (syncedState.state === 'external') {
    vscode.window.showInformationMessage(`Reverse tunnel is already started externally: ${remote.hostLabel}`);
    return;
  }

  setRemoteTunnelState(remote.key, 'starting');
  state.lastError = null;
  state.stopRequested = false;
  state.externalPid = null;
  state.stderrLogState = createSshStderrLogState();

  try {
    await verifySshExists(config.sshPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(`[error] ${message}`);
    state.lastError = message;
    setRemoteTunnelState(remote.key, 'failed');
    vscode.window.showErrorMessage(
      `SSH command is unavailable. Install OpenSSH or update 'sshPath' in the ToolBox config file. Details: ${message}`
    );
    return;
  }

  const args = [
    '-N',
    '-p',
    String(remote.remotePort),
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    '-R',
    remote.reverseSpec
  ];

  if (remote.identityFile.length > 0) {
    args.push('-i', remote.identityFile);
  }

  args.push(remote.remoteTarget);

  appendDebugLine(`[start] ${config.sshPath} ${args.join(' ')}`);

  try {
    state.sshProcess = spawn(config.sshPath, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.lastError = message;
    outputChannel.appendLine(`[error] failed to spawn ssh remote=${remote.key}: ${message}`);
    vscode.window.showErrorMessage(`Failed to start reverse tunnel ${remote.hostLabel}: ${message}`);
    state.sshProcess = null;
    setRemoteTunnelState(remote.key, 'failed');
    return;
  }

  let hasFailed = false;
  const markFailed = (message: string): void => {
    if (hasFailed) {
      return;
    }
    hasFailed = true;
    state.lastError = message;
    outputChannel.appendLine(`[error] ${message}`);
    setRemoteTunnelState(remote.key, 'failed');
    vscode.window.showErrorMessage(message);
  };

  if (state.connectTimer) {
    clearTimeout(state.connectTimer);
  }
  state.connectTimer = setTimeout(() => {
    if (state.sshProcess && !hasFailed && !state.stopRequested) {
      setRemoteTunnelState(remote.key, 'connected');
      vscode.window.showInformationMessage(`Reverse tunnel started: ${remote.hostLabel}`);
    }
  }, config.connectionReadyDelayMs);

  state.sshProcess.stdout.on('data', (data: Buffer) => {
    appendDebugLine(`[stdout] [${remote.key}] ${data.toString().trim()}`);
  });

  state.sshProcess.stderr.on('data', (data: Buffer) => {
    const lines = data
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const text of lines) {
      if (shouldLogSshStderr(text, config, Date.now(), state.stderrLogState)) {
        outputChannel.appendLine(`[stderr] [${remote.key}] ${text}`);
      }
    }

    const text = lines.join('\n');
    if (/remote port forwarding failed/i.test(text) || /address already in use/i.test(text)) {
      markFailed(`Reverse tunnel failed: remote port ${remote.remoteBindPort} is already in use on ${remote.hostLabel}.`);
      if (state.sshProcess) {
        state.sshProcess.kill();
      }
    }
  });

  state.sshProcess.on('error', (err: Error) => {
    markFailed(`Reverse tunnel failed for ${remote.hostLabel}: ${err.message}`);
  });

  state.sshProcess.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    appendDebugLine(`[stop] [${remote.key}] ssh exited with code=${code} signal=${signal}`);
    if (state.connectTimer) {
      clearTimeout(state.connectTimer);
      state.connectTimer = null;
    }

    state.sshProcess = null;
    state.externalPid = null;
    if (state.stopRequested) {
      setRemoteTunnelState(remote.key, 'stopped');
    } else if (hasFailed) {
      // Keep failed state.
    } else if (state.state === 'starting') {
      markFailed(`Reverse tunnel failed before connection established for ${remote.hostLabel} (code=${code}, signal=${signal}).`);
    } else if (state.state === 'connected') {
      markFailed(`Reverse tunnel disconnected unexpectedly for ${remote.hostLabel} (code=${code}, signal=${signal}).`);
    } else {
      setRemoteTunnelState(remote.key, 'stopped');
    }

    state.stopRequested = false;
  });

  outputChannel.show(true);
}

function stopRemoteTunnel(remoteKey: string): void {
  const state = remoteTunnelStates.get(remoteKey);
  if (!state || !state.sshProcess) {
    vscode.window.showInformationMessage(`Reverse tunnel is not managed by this window: ${remoteKey}`);
    return;
  }

  outputChannel.appendLine(`[stop] stopping ssh reverse tunnel remote=${remoteKey}`);
  state.stopRequested = true;
  if (state.connectTimer) {
    clearTimeout(state.connectTimer);
    state.connectTimer = null;
  }
  state.sshProcess.kill();
  state.sshProcess = null;
  state.externalPid = null;
  setRemoteTunnelState(remoteKey, 'stopped');
  vscode.window.showInformationMessage(`Reverse tunnel stopping: ${remoteKey}`);
}

function showLogs(): void {
  outputChannel.show(true);
}


function getReverseTunnelStatesForTest(): unknown[] {
  return Array.from(remoteTunnelStates.entries()).map(([remoteKey, state]) => ({
    remoteKey,
    state: state.state,
    externalPid: state.externalPid
  }));
}

function resetReverseTunnelStatesForTest(): void {
  for (const state of remoteTunnelStates.values()) {
    if (state.connectTimer) {
      clearTimeout(state.connectTimer);
    }
    if (state.sshProcess) {
      state.stopRequested = true;
      state.sshProcess.kill();
    }
  }
  remoteTunnelStates.clear();
  void toolBoxWebviewProvider?.refresh();
}

function disposeReverseTunnelState(): void {
  for (const state of remoteTunnelStates.values()) {
    if (state.connectTimer) {
      clearTimeout(state.connectTimer);
      state.connectTimer = null;
    }
    if (state.sshProcess) {
      state.stopRequested = true;
      state.sshProcess.kill();
      state.sshProcess = null;
    }
  }
  remoteTunnelStates.clear();
}

function startReverseTunnelStatePolling(context: vscode.ExtensionContext): void {
  let polling = false;
  const timer = setInterval(() => {
    if (polling) {
      return;
    }

    polling = true;
    void reverseTunnelService?.syncStateFromSystem()
      .finally(() => {
        polling = false;
      });
  }, REVERSE_TUNNEL_STATE_POLL_INTERVAL_MS);

  context.subscriptions.push(new vscode.Disposable(() => {
    clearInterval(timer);
  }));
}

function getToolBoxConfigPathInfo(): ToolBoxConfigPathInfo {
  const toolBoxConfig = vscode.workspace.getConfiguration(TOOLBOX_CONFIGURATION_SECTION);
  const inspected = toolBoxConfig.inspect<string>(TOOLBOX_CONFIG_FILE_SETTING);
  const hasConfiguredPath = inspected?.globalValue !== undefined
    || inspected?.workspaceValue !== undefined
    || inspected?.workspaceFolderValue !== undefined
    || inspected?.defaultLanguageValue !== undefined
    || inspected?.globalLanguageValue !== undefined
    || inspected?.workspaceLanguageValue !== undefined
    || inspected?.workspaceFolderLanguageValue !== undefined;
  const { configPath, configUri } = getConfiguredConfigFileRef();

  return {
    configPath,
    configUri,
    hasConfiguredPath
  };
}

async function writeToolBoxConfigFile(configPath: string, config: BootstrapToolBoxConfig | unknown, configUri?: vscode.Uri): Promise<void> {
  const uri = configUri ?? getToolBoxConfigUriFromPath(configPath);
  const parentUri = vscode.Uri.joinPath(uri, '..');
  await vscode.workspace.fs.createDirectory(parentUri);
  await vscode.workspace.fs.writeFile(
    uri,
    Buffer.from(JSON.stringify(config, null, 2) + '\n', 'utf8')
  );
}

async function readToolBoxConfigRootForUpdate(configPath: string): Promise<Record<string, unknown>> {
  const existing = await readToolBoxConfigRoot(configPath, true);
  return existing ?? (JSON.parse(getDefaultConfigJsonContent()) as Record<string, unknown>);
}

function getFavoriteWorkspaceFilesForUpdate(root: Record<string, unknown>): string[] {
  const section =
    root.favoriteWorkspaces && typeof root.favoriteWorkspaces === 'object' && !Array.isArray(root.favoriteWorkspaces)
      ? (root.favoriteWorkspaces as Record<string, unknown>)
      : {};
  return assertStringArray(section.workspaceFiles ?? [], 'favoriteWorkspaces.workspaceFiles');
}

async function writeFavoriteWorkspaceFiles(configPath: string, workspaceFiles: string[]): Promise<void> {
  const { configUri } = getToolBoxConfigPathInfo();
  const root = await readToolBoxConfigRootForUpdate(configPath);
  root.favoriteWorkspaces = { workspaceFiles };
  await writeToolBoxConfigFile(configPath, root, configUri);
  await updateToolBoxConfigFileSetting(configPath);
  await refreshToolBoxAfterConfigChange();
}

async function updateToolBoxConfigFileSetting(configPath: string): Promise<void> {
  const configInfo = getToolBoxConfigPathInfo();
  if (configInfo.hasConfiguredPath || configInfo.configUri.scheme !== 'file') {
    return;
  }
  await vscode.workspace
    .getConfiguration(TOOLBOX_CONFIGURATION_SECTION)
    .update(TOOLBOX_CONFIG_FILE_SETTING, configPath, vscode.ConfigurationTarget.Global);
}

async function openToolBoxConfigFile(configPath: string): Promise<string> {
  const doc = await vscode.workspace.openTextDocument(getToolBoxConfigUriFromPath(configPath));
  await vscode.window.showTextDocument(doc, { preview: false });
  return configPath;
}

function parsePortInput(value: string, fieldName: string): number {
  const port = Number(value.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${fieldName} must be an integer from 1 to 65535.`);
  }
  return port;
}

function parseLocalTargetInput(value: string): { localHost: string; localPort: number } {
  const trimmed = value.trim();
  const separatorIndex = trimmed.lastIndexOf(':');
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    throw new Error('Enter local target as localHost:localPort.');
  }

  const localHost = trimmed.slice(0, separatorIndex).trim();
  if (!localHost) {
    throw new Error('localHost is required.');
  }

  return {
    localHost,
    localPort: parsePortInput(trimmed.slice(separatorIndex + 1), 'localPort')
  };
}

function validateLocalTargetInput(value: string): string | undefined {
  try {
    parseLocalTargetInput(value);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function validatePortInput(fieldName: string): (value: string) => string | undefined {
  return (value: string): string | undefined => {
    try {
      parsePortInput(value, fieldName);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
}

function validateRequiredInput(fieldName: string): (value: string) => string | undefined {
  return (value: string): string | undefined => value.trim() ? undefined : `${fieldName} is required.`;
}

async function promptRequiredInput(options: vscode.InputBoxOptions & { fieldName: string }): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    ...options,
    ignoreFocusOut: true,
    validateInput: options.validateInput ?? validateRequiredInput(options.fieldName)
  });
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function promptPort(fieldName: string, value: string): Promise<number | undefined> {
  const input = await vscode.window.showInputBox({
    prompt: fieldName,
    value,
    ignoreFocusOut: true,
    validateInput: validatePortInput(fieldName)
  });
  return input === undefined ? undefined : parsePortInput(input, fieldName);
}

async function promptLocalRootDir(): Promise<string | undefined> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select rootDir'
  });

  const first = selected?.[0];
  return first ? first.fsPath : undefined;
}

async function runBootstrapWizard(): Promise<BootstrapToolBoxConfig | undefined> {
  const localTargetInput = await vscode.window.showInputBox({
    prompt: 'Reverse proxy local target (localHost:localPort)',
    value: '127.0.0.1:7897',
    ignoreFocusOut: true,
    validateInput: validateLocalTargetInput
  });
  if (localTargetInput === undefined) {
    return undefined;
  }

  const localTarget = parseLocalTargetInput(localTargetInput);
  const remotes: RemoteProxyConfig[] = [];
  while (true) {
    const action = await vscode.window.showQuickPick(
      ['Add remote', 'Finish remotes'],
      {
        placeHolder: remotes.length === 0 ? 'Add a reverse proxy remote or finish with none.' : 'Add another remote or finish.',
        ignoreFocusOut: true
      }
    );
    if (!action) {
      return undefined;
    }
    if (action === 'Finish remotes') {
      break;
    }

    const remoteHost = await promptRequiredInput({
      fieldName: 'remoteHost',
      prompt: 'Remote host address'
    });
    if (remoteHost === undefined) {
      return undefined;
    }

    const remotePort = await promptPort('remotePort', '4001');
    if (remotePort === undefined) {
      return undefined;
    }

    const remoteUser = await promptRequiredInput({
      fieldName: 'remoteUser',
      prompt: 'Remote SSH username'
    });
    if (remoteUser === undefined) {
      return undefined;
    }

    const remoteBindPort = await promptPort('remoteBindPort', '17897');
    if (remoteBindPort === undefined) {
      return undefined;
    }

    remotes.push({
      remoteHost,
      remotePort,
      remoteUser,
      remoteBindPort,
      identityFile: ''
    });
  }

  const selectedMode = await vscode.window.showQuickPick(['local', 'ssh'], {
    placeHolder: 'Pinned Projects mode',
    ignoreFocusOut: true
  });
  if (!selectedMode) {
    return undefined;
  }
  const mode = selectedMode as KeyProjectsMode;

  let sshTarget = '';
  let sshPort = 22;
  if (mode === 'ssh') {
    const target = await promptRequiredInput({
      fieldName: 'sshTarget',
      prompt: 'Pinned Projects SSH target, for example user@example.com'
    });
    if (target === undefined) {
      return undefined;
    }
    sshTarget = target;

    const port = await promptPort('sshPort', '22');
    if (port === undefined) {
      return undefined;
    }
    sshPort = port;
  }

  const rootDir = mode === 'local'
    ? await promptLocalRootDir()
    : await promptRequiredInput({
      fieldName: 'rootDir',
      prompt: 'Pinned Projects rootDir'
    });
  if (rootDir === undefined) {
    return undefined;
  }

  const repoNames: string[] = [];
  while (true) {
    const action = await vscode.window.showQuickPick(
      ['Add repo', 'Finish repos'],
      {
        placeHolder: repoNames.length === 0 ? 'Add a repo name or finish with none.' : 'Add another repo or finish.',
        ignoreFocusOut: true
      }
    );
    if (!action) {
      return undefined;
    }
    if (action === 'Finish repos') {
      break;
    }

    const repoName = await promptRequiredInput({
      fieldName: 'repoName',
      prompt: 'Repository name under rootDir. Use . for rootDir itself.'
    });
    if (repoName === undefined) {
      return undefined;
    }
    repoNames.push(repoName);
  }

  return {
    ReverseTunnel: {
      sshPath: 'ssh',
      connectionReadyDelayMs: 1200,
      localHost: localTarget.localHost,
      localPort: localTarget.localPort,
      remotes
    },
    keyProjects: {
      mode,
      rootDir,
      repoNames,
      sshTarget,
      sshPort,
      gitPath: 'git',
      sshPath: 'ssh'
    },
    favoriteWorkspaces: {
      workspaceFiles: []
    }
  };
}

async function refreshToolBoxAfterConfigChange(): Promise<void> {
  invalidateKeyProjectsCache('config file changed');
  void reverseTunnelService?.syncStateFromSystem();
  void toolBoxWebviewProvider?.refresh();
}

async function bootstrapConfig(): Promise<string | undefined> {
  const { configPath, configUri } = getToolBoxConfigPathInfo();

  if (await configFileExists(configUri)) {
    const confirmation = await vscode.window.showWarningMessage(
      'Overwrite existing ToolBox config?',
      { modal: true },
      'Overwrite'
    );
    if (confirmation !== 'Overwrite') {
      return undefined;
    }
  }

  const config = await runBootstrapWizard();
  if (!config) {
    return undefined;
  }

  await writeToolBoxConfigFile(configPath, config, configUri);
  await updateToolBoxConfigFileSetting(configPath);
  await refreshToolBoxAfterConfigChange();
  void vscode.window.showInformationMessage(`ToolBox config file created: ${configPath}`);
  return openToolBoxConfigFile(configPath);
}

async function openSettingsConfig(): Promise<string | undefined> {
  const { configPath, configUri, hasConfiguredPath } = getToolBoxConfigPathInfo();

  if (!(await configFileExists(configUri))) {
    const action = await vscode.window.showQuickPick(['Create default config', 'Run bootstrap wizard'], {
      placeHolder: 'ToolBox config does not exist.',
      ignoreFocusOut: true
    });
    if (!action) {
      return undefined;
    }
    if (action === 'Run bootstrap wizard') {
      return bootstrapConfig();
    }

    await writeToolBoxConfigFile(configPath, JSON.parse(getDefaultConfigJsonContent()), configUri);
    await updateToolBoxConfigFileSetting(configPath);
    await refreshToolBoxAfterConfigChange();
    void vscode.window.showInformationMessage(`ToolBox config file created: ${configPath}`);
  } else if (!hasConfiguredPath) {
    await updateToolBoxConfigFileSetting(configPath);
  }

  return openToolBoxConfigFile(configPath);
}

async function addFavoriteWorkspace(): Promise<string | undefined> {
  const selection = await vscode.window.showOpenDialog({
    defaultUri: vscode.Uri.file(os.homedir()),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      'VS Code Workspaces': ['code-workspace']
    },
    title: 'Select a VS Code workspace file'
  });
  const selectedUri = selection?.[0];
  if (!selectedUri) {
    return undefined;
  }
  if (selectedUri.scheme !== 'file') {
    void vscode.window.showErrorMessage('Favorite workspaces must be local .code-workspace files.');
    return undefined;
  }
  const selected = selectedUri.fsPath;
  if (path.extname(selected).toLowerCase() !== '.code-workspace') {
    void vscode.window.showErrorMessage('Select a .code-workspace file.');
    return undefined;
  }

  const { configPath } = getToolBoxConfigPathInfo();
  const root = await readToolBoxConfigRootForUpdate(configPath);
  const existing = getFavoriteWorkspaceFilesForUpdate(root);
  const normalizedSelected = path.normalize(selected);
  const exists = existing.some((entry) => path.normalize(resolvePathFromConfigDir(configPath, entry)).toLowerCase() === normalizedSelected.toLowerCase());
  if (!exists) {
    const next = [...existing, normalizedSelected];
    await writeFavoriteWorkspaceFiles(configPath, next);
    await refreshFavoriteWorkspaceAnalysis(next.map((entry) => resolvePathFromConfigDir(configPath, entry)));
    void toolBoxWebviewProvider?.refresh();
  } else {
    await updateToolBoxConfigFileSetting(configPath);
    void toolBoxWebviewProvider?.refresh();
  }
  return normalizedSelected;
}

async function refreshFavoriteWorkspaces(): Promise<void> {
  if (favoriteWorkspacesRefreshPromise) {
    return favoriteWorkspacesRefreshPromise;
  }

  favoriteWorkspacesRefreshPromise = (async () => {
    const config = await getFavoriteWorkspacesConfig();
    await refreshFavoriteWorkspaceAnalysis(config.workspaceFiles);
  })();

  void toolBoxWebviewProvider?.refresh();
  try {
    await favoriteWorkspacesRefreshPromise;
  } finally {
    favoriteWorkspacesRefreshPromise = null;
    void toolBoxWebviewProvider?.refresh();
  }
}

async function removeFavoriteWorkspace(workspacePath: string): Promise<void> {
  const { configPath } = getToolBoxConfigPathInfo();
  const root = await readToolBoxConfigRootForUpdate(configPath);
  const normalizedTarget = path.normalize(workspacePath).toLowerCase();
  const next = getFavoriteWorkspaceFilesForUpdate(root)
    .filter((entry) => path.normalize(resolvePathFromConfigDir(configPath, entry)).toLowerCase() !== normalizedTarget);
  await writeFavoriteWorkspaceFiles(configPath, next);
  await refreshFavoriteWorkspaceAnalysis(next.map((entry) => resolvePathFromConfigDir(configPath, entry)));
}

async function openFavoriteWorkspace(workspacePath: string): Promise<void> {
  if (!fs.existsSync(workspacePath)) {
    void vscode.window.showErrorMessage(`Favorite workspace does not exist: ${workspacePath}`);
    return;
  }
  try {
    JSON.parse(await fs.promises.readFile(workspacePath, 'utf8'));
  } catch (error) {
    void vscode.window.showErrorMessage(`Favorite workspace is not a valid JSON file: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspacePath), { forceNewWindow: true });
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContextRef = context;
  outputChannel = createTimestampedOutputChannel(vscode.window.createOutputChannel('CodeOps Panel'));
  reverseTunnelService = new ReverseTunnelService({
    getViewModel: getReverseTunnelViewModel,
    getSidebarItemsForTest: getReverseTunnelSidebarItemsForTest,
    syncStateFromSystem: () => syncProxyStateFromSystem(),
    start: startRemoteTunnel,
    stop: stopRemoteTunnel,
    resetStatesForTest: resetReverseTunnelStatesForTest,
    getStatesForTest: getReverseTunnelStatesForTest,
    dispose: disposeReverseTunnelState
  });
  pinnedProjectsService = new PinnedProjectsService({
    getViewModel: getKeyProjectsViewModel,
    refresh: refreshKeyProjects,
    invalidateCache: invalidateKeyProjectsCache,
    openSettings: openKeyProjectsSettings,
    showStatus: showKeyProjectStatus,
    getSidebarItemsForTest: getKeyProjectSidebarItemsForTest,
    setWorkspaceOverrideForTest: setKeyProjectsWorkspaceOverrideForTest
  });
  toolBoxWebviewProvider = new ToolBoxWebviewProvider({
    getModel: getToolBoxViewModel,
    render: renderToolBoxWebview,
    getPinnedProjectDetail: getPinnedProjectDetailForWebview,
    showLogs,
    openProxySettings: async () => {
      await openSettingsConfig();
    },
    bootstrapConfig: async () => {
      await bootstrapConfig();
    },
    refreshPinnedProjects: () => pinnedProjectsService?.refresh() ?? refreshKeyProjects(),
    addFavoriteWorkspace: async () => {
      await addFavoriteWorkspace();
    },
    refreshFavoriteWorkspaces,
    removeFavoriteWorkspace,
    openFavoriteWorkspace,
    startReverseTunnel: (remoteKey) => reverseTunnelService?.start(remoteKey) ?? startRemoteTunnel(remoteKey),
    stopReverseTunnel: (remoteKey) => (reverseTunnelService ?? { stop: stopRemoteTunnel }).stop(remoteKey)
  });

  if (vscode.env.remoteName) {
    appendDebugLine(`[mode] remote workspace detected (${vscode.env.remoteName}); extension runs on local UI host.`);
  }

  void vscode.workspace.fs.createDirectory(context.globalStorageUri);
  void reverseTunnelService.syncStateFromSystem();
  startReverseTunnelStatePolling(context);

  const toolBoxWebviewRegistration = vscode.window.registerWebviewViewProvider(ToolBoxWebviewProvider.viewType, toolBoxWebviewProvider);

  context.subscriptions.push(
    outputChannel,
    toolBoxWebviewRegistration,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${TOOLBOX_CONFIGURATION_SECTION}.${TOOLBOX_CONFIG_FILE_SETTING}`)) {
        invalidateKeyProjectsCache('config file setting changed');
        void reverseTunnelService?.syncStateFromSystem();
      }
      if (event.affectsConfiguration(TOOLBOX_CONFIGURATION_SECTION)) {
        void toolBoxWebviewProvider?.refresh();
      }
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
    vscode.commands.registerCommand('reverseProxy.bootstrapConfig', async () => {
      return bootstrapConfig();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.openKeyProjectSettings', async () => {
      return pinnedProjectsService?.openSettings();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.refreshKeyProjects', async () => {
      await pinnedProjectsService?.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.showKeyProjectStatus', async (repoName: string) => {
      return pinnedProjectsService?.showStatus(repoName);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.getToolBoxViewState', async () => {
      return getToolBoxViewModel();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.renderToolBoxHtml', async () => {
      return renderToolBoxWebview({ cspSource: 'vscode-test-resource' } as vscode.Webview, await getToolBoxViewModel());
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.getFavoriteWorkspacesViewState', async () => {
      return getFavoriteWorkspacesViewModel();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.addFavoriteWorkspace', async () => {
      return addFavoriteWorkspace();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.refreshFavoriteWorkspaces', async () => {
      return refreshFavoriteWorkspaces();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.removeFavoriteWorkspace', async (workspacePath: string) => {
      return removeFavoriteWorkspace(workspacePath);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.getSidebarItems', async () => {
      return getSidebarItemsForTest();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.getKeyProjectsViewState', async () => {
      return pinnedProjectsService?.getViewModel();
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
        const request = typeof args === 'string' ? { label: args } : args;
        const snapshot = await getSidebarItemsForTest();
        const item = snapshot.children.find((entry) => entry.label === request.label && (!request.parentLabel || entry.parentLabel === request.parentLabel));
        if (!item || !item.command) {
          throw new Error('Sidebar item ' + request.label + ' is not clickable.');
        }
        return vscode.commands.executeCommand(item.command, ...(item.arguments ?? []));
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.syncStateFromSystem', async () => {
      await reverseTunnelService?.syncStateFromSystem();
      return reverseTunnelService?.getStatesForTest();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.startRemoteTunnel', async (remoteKey: string) => {
      await reverseTunnelService?.start(remoteKey);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.stopRemoteTunnel', (remoteKey: string) => {
      reverseTunnelService?.stop(remoteKey);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.resetRemoteTunnelStates', () => {
      reverseTunnelService?.resetStatesForTest();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.getWindowsProcessInspectionScript', () => {
      return buildWindowsProcessInspectionScript();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.formatLogLine', (message: string, isoDate: string) => {
      return formatLogLine(message, new Date(isoDate));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.shouldLogSshStderrSequence', (messages: string[], localHost: string, localPort: number, offsetsMs: number[]) => {
      const stderrLogState: SshStderrLogState = {
        lastLocalTargetConnectFailureLogAt: new Map<string, number>(),
        localTargetConnectFailureContextUntilMs: 0
      };
      return messages.map((message, index) =>
        shouldLogSshStderr(message, { localHost, localPort }, offsetsMs[index] ?? 0, stderrLogState)
      );
    })
  );


  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.openSettingsWithDirectory', async (dir: string) => {
      const toolBoxConfig = vscode.workspace.getConfiguration(TOOLBOX_CONFIGURATION_SECTION);
      const finalConfigPath = path.join(dir, DEFAULT_CREATED_TOOLBOX_CONFIG_FILE);
      await toolBoxConfig.update(TOOLBOX_CONFIG_FILE_SETTING, finalConfigPath, vscode.ConfigurationTarget.Global);
      return openSettingsConfig();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.setKeyProjectsWorkspaceOverride', async (workspacePath?: string | null) => {
      return pinnedProjectsService?.setWorkspaceOverrideForTest(workspacePath);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('reverseProxy.test.openKeyProjectSettingsWithDirectory', async (dir: string) => {
      const finalConfigPath = path.join(dir, DEFAULT_CREATED_TOOLBOX_CONFIG_FILE);
      await vscode.workspace.getConfiguration(TOOLBOX_CONFIGURATION_SECTION).update(TOOLBOX_CONFIG_FILE_SETTING, finalConfigPath, vscode.ConfigurationTarget.Global);
      return openSettingsConfig();
    })
  );
}

export function deactivate(): void {
  toolBoxWebviewProvider = null;
  reverseTunnelService?.dispose();
  reverseTunnelService = null;
  pinnedProjectsService = null;
}



