import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

let sshProcess: ChildProcessWithoutNullStreams | null = null;
let externalTunnelPid: number | null = null;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let connectTimer: NodeJS.Timeout | null = null;
let stopRequested = false;
let extensionContextRef: vscode.ExtensionContext | null = null;
let sidebarViewProvider: ProxySidebarProvider | null = null;

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

class ProxySidebarProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private static readonly groupLabel = 'ReverseTunnel';
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (!element) {
      const group = new vscode.TreeItem(ProxySidebarProvider.groupLabel, vscode.TreeItemCollapsibleState.Expanded);
      group.iconPath = new vscode.ThemeIcon('symbol-namespace');
      return [group];
    }

    if (String(element.label) !== ProxySidebarProvider.groupLabel) {
      return [];
    }

    return this.buildItems();
  }

  getItemsForTest(): {
    root: Array<{ label: string; command?: string; enabled: boolean }>;
    children: Array<{ label: string; command?: string; enabled: boolean }>;
  } {
    const mapItem = (item: vscode.TreeItem) => {
      const command =
        item.command && typeof item.command === 'object' && 'command' in item.command
          ? item.command.command
          : undefined;
      return {
        label: String(item.label ?? ''),
        command,
        enabled: Boolean(command)
      };
    };

    const root = [
      new vscode.TreeItem(ProxySidebarProvider.groupLabel, vscode.TreeItemCollapsibleState.Expanded)
    ].map((item) => mapItem(item));
    const children = this.buildItems().map((item) => mapItem(item));
    return { root, children };
  }

  private buildItems(): vscode.TreeItem[] {
    const toggle = new vscode.TreeItem(
      proxyState === 'connected'
        ? 'ReverseTun: ON'
        : proxyState === 'starting'
          ? 'ReverseTun: CONNECTING...'
          : 'ReverseTun: OFF',
      vscode.TreeItemCollapsibleState.None
    );

    const logs = new vscode.TreeItem('Open Logs', vscode.TreeItemCollapsibleState.None);
    logs.iconPath = new vscode.ThemeIcon('output');
    logs.command = { command: 'reverseProxy.showLogs', title: 'Open Logs' };
    const settings = new vscode.TreeItem('Settings', vscode.TreeItemCollapsibleState.None);
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
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'reverseProxy.showStatus';
  setProxyState('stopped');
  statusBarItem.show();
  sidebarViewProvider = new ProxySidebarProvider();

  if (vscode.env.remoteName) {
    outputChannel.appendLine(`[mode] remote workspace detected (${vscode.env.remoteName}); extension runs on local UI host.`);
  }

  void syncProxyStateFromSystem();

  context.subscriptions.push(
    outputChannel,
    statusBarItem,
    vscode.window.registerTreeDataProvider('reverseProxy.sidebarView', sidebarViewProvider)
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
    vscode.commands.registerCommand('reverseProxy.test.getSidebarItems', () => {
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
    vscode.commands.registerCommand('reverseProxy.test.clickSidebarItem', async (label: string) => {
      if (!sidebarViewProvider) {
        throw new Error('Sidebar provider is not initialized.');
      }
      const item = sidebarViewProvider.getItemsForTest().children.find((x) => x.label === label);
      if (!item || !item.command || !item.enabled) {
        throw new Error(`Sidebar item '${label}' is not clickable.`);
      }
      await vscode.commands.executeCommand(item.command);
    })
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
}

export function deactivate(): void {
  sidebarViewProvider = null;
  externalTunnelPid = null;
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
  if (sshProcess) {
    sshProcess.kill();
    sshProcess = null;
  }
}

