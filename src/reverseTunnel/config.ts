import * as fs from 'fs';
import * as path from 'path';
import { assertNumber, assertObject, assertString } from '../shared/validation';

export type RemoteProxyConfig = {
  remoteHost: string;
  remotePort: number;
  remoteUser: string;
  remoteBindPort: number;
  identityFile: string;
};

export type FileProxyConfig = {
  sshPath: string;
  connectionReadyDelayMs: number;
  localHost: string;
  localPort: number;
  remotes: RemoteProxyConfig[];
};

export type RuntimeRemoteProxyConfig = RemoteProxyConfig & {
  key: string;
  hostLabel: string;
  remoteTarget: string;
  reverseSpec: string;
};

export type RuntimeProxyConfig = Omit<FileProxyConfig, 'remotes'> & {
  loadedConfigPath: string;
  remotes: RuntimeRemoteProxyConfig[];
};

export type ResolvePathOptions = {
  workspaceFolder?: string;
  remoteName?: string;
  homeDir?: string;
  extensionPath?: string;
};

export function getRemoteKey(remote: Pick<RemoteProxyConfig, 'remoteUser' | 'remoteHost' | 'remotePort'>): string {
  return `${remote.remoteUser}@${remote.remoteHost}:${remote.remotePort}`;
}

export function resolveConfiguredConfigPathWithContext(configFile: string, options?: ResolvePathOptions): string {
  const expanded = expandWorkspaceFolderToken(configFile, options?.workspaceFolder);
  configFile = expanded;
  if (path.isAbsolute(configFile)) {
    return configFile;
  }

  const workspaceFolder = options?.workspaceFolder;
  const homeDir = options?.homeDir;

  if (workspaceFolder) {
    return path.join(workspaceFolder, configFile);
  }

  if (!homeDir) {
    throw new Error('Home directory is required to resolve relative config path.');
  }

  return path.join(homeDir, configFile);
}

export function resolveConfigPathWithContext(configFile: string, options: ResolvePathOptions): string {
  return resolveConfiguredConfigPathWithContext(configFile, options);
}

function expandWorkspaceFolderToken(configFile: string, workspaceFolder?: string): string {
  const match = configFile.match(/^\$\{workspace(?:Folder|Root)\}(?:[\\/](.*))?$/i);
  if (!match) {
    return configFile;
  }
  if (!workspaceFolder) {
    throw new Error('Workspace folder is required to resolve ${workspaceFolder} in config path.');
  }

  const relativePath = match[1] ?? '';
  return relativePath ? path.join(workspaceFolder, relativePath) : workspaceFolder;
}

export function parseFileProxyConfigContent(content: string, source: string): FileProxyConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse config file '${source}': ${message}`);
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid config file '${source}': root must be a JSON object.`);
  }

  const root = raw as Record<string, unknown>;
  const section = root.ReverseTunnel;
  if (!section || typeof section !== 'object') {
    throw new Error(`Invalid config file '${source}': missing object field 'ReverseTunnel'.`);
  }

  const data = section as Record<string, unknown>;
  const connectionReadyDelayMs = assertNumber(data.connectionReadyDelayMs, 'ReverseTunnel.connectionReadyDelayMs');
  if (connectionReadyDelayMs <= 0) {
    throw new Error(`Invalid config field 'ReverseTunnel.connectionReadyDelayMs': expected > 0.`);
  }

  if (!Array.isArray(data.remotes)) {
    throw new Error(`Invalid config field 'ReverseTunnel.remotes': expected remote config array.`);
  }

  const seenRemoteKeys = new Set<string>();
  const remotes = data.remotes.map((entry, index) => {
    const remoteData = assertObject(entry, `ReverseTunnel.remotes[${index}]`);
    const remote: RemoteProxyConfig = {
      remoteHost: assertString(remoteData.remoteHost, `ReverseTunnel.remotes[${index}].remoteHost`),
      remotePort: assertNumber(remoteData.remotePort, `ReverseTunnel.remotes[${index}].remotePort`),
      remoteUser: assertString(remoteData.remoteUser, `ReverseTunnel.remotes[${index}].remoteUser`),
      remoteBindPort: assertNumber(remoteData.remoteBindPort, `ReverseTunnel.remotes[${index}].remoteBindPort`),
      identityFile: typeof remoteData.identityFile === 'string' ? remoteData.identityFile.trim() : ''
    };
    const key = getRemoteKey(remote);
    if (seenRemoteKeys.has(key)) {
      throw new Error(`Invalid config field 'ReverseTunnel.remotes[${index}]': duplicate remote '${key}'.`);
    }
    seenRemoteKeys.add(key);
    return remote;
  });

  return {
    sshPath: assertString(data.sshPath, 'ReverseTunnel.sshPath'),
    connectionReadyDelayMs,
    localHost: assertString(data.localHost, 'ReverseTunnel.localHost'),
    localPort: assertNumber(data.localPort, 'ReverseTunnel.localPort'),
    remotes
  };
}

export function loadFileProxyConfig(filePath: string): FileProxyConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }
  return parseFileProxyConfigContent(fs.readFileSync(filePath, 'utf8'), filePath);
}

export function getRuntimeProxyConfigFromFileConfig(fileConfig: FileProxyConfig, configPath: string): RuntimeProxyConfig {
  return {
    sshPath: fileConfig.sshPath,
    connectionReadyDelayMs: fileConfig.connectionReadyDelayMs,
    localHost: fileConfig.localHost,
    localPort: fileConfig.localPort,
    loadedConfigPath: configPath,
    remotes: fileConfig.remotes.map((remote) => ({
      ...remote,
      key: getRemoteKey(remote),
      hostLabel: `${remote.remoteHost}:${remote.remotePort}`,
      remoteTarget: `${remote.remoteUser}@${remote.remoteHost}`,
      reverseSpec: `${remote.remoteBindPort}:${fileConfig.localHost}:${fileConfig.localPort}`
    }))
  };
}

export function getRuntimeProxyConfig(configPath: string): RuntimeProxyConfig {
  return getRuntimeProxyConfigFromFileConfig(loadFileProxyConfig(configPath), configPath);
}

export function getDefaultConfigJsonContent(): string {
  return JSON.stringify(
    {
      ReverseTunnel: {
        sshPath: 'ssh',
        connectionReadyDelayMs: 1200,
        localHost: '127.0.0.1',
        localPort: 7897,
        remotes: [
          {
            remoteHost: 'FOO_ADDRESS',
            remotePort: 4001,
            remoteUser: 'FOO_USER',
            remoteBindPort: 17897,
            identityFile: ''
          }
        ]
      },
      keyProjects: {
        mode: 'local',
        rootDir: '',
        repoNames: [],
        sshTarget: '',
        sshPort: 22,
        gitPath: 'git',
        sshPath: 'ssh'
      },
      favoriteWorkspaces: {
        workspaceFiles: []
      }
    },
    null,
    2
  );
}
