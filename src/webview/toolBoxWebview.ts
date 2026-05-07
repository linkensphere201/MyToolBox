import * as vscode from 'vscode';

type ToolBoxWebviewMessage = {
  type?: string;
  repoName?: string;
  action?: string;
  remoteKey?: string;
  left?: number;
  top?: number;
};

type DetailMessage = {
  title: string;
  text: string;
};

export type ToolBoxWebviewProviderDeps = {
  getModel: () => Promise<unknown>;
  render: (webview: vscode.Webview, model: unknown) => string;
  getPinnedProjectDetail: (repoName: string) => Promise<DetailMessage>;
  showLogs: () => void;
  openProxySettings: () => Promise<void>;
  refreshPinnedProjects: () => Promise<void>;
  openPinnedProjectSettings: () => Promise<unknown>;
  startReverseTunnel: (remoteKey: string) => Promise<void>;
  stopReverseTunnel: (remoteKey: string) => void;
};

export class ToolBoxWebviewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'reverseProxy.sidebarView';
  private view: vscode.WebviewView | null = null;

  constructor(private readonly deps: ToolBoxWebviewProviderDeps) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = null;
      }
    });

    webviewView.webview.onDidReceiveMessage(async (message: ToolBoxWebviewMessage) => {
      await this.handleMessage(webviewView, message);
    });

    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    const model = await this.deps.getModel();
    this.view.webview.html = this.deps.render(this.view.webview, model);
  }

  private async handleMessage(webviewView: vscode.WebviewView, message: ToolBoxWebviewMessage): Promise<void> {
    if (message.type === 'showStatus' && message.repoName) {
      const detail = await this.deps.getPinnedProjectDetail(message.repoName);
      await webviewView.webview.postMessage({
        type: 'detail',
        title: detail.title,
        text: detail.text,
        left: message.left,
        top: message.top
      });
      return;
    }

    if (message.type === 'reverseTunnel' && message.action && message.remoteKey) {
      if (message.action === 'start') {
        await this.deps.startReverseTunnel(message.remoteKey);
      } else if (message.action === 'stop') {
        this.deps.stopReverseTunnel(message.remoteKey);
      }
      return;
    }

    if (message.type !== 'action' || !message.action) {
      return;
    }

    switch (message.action) {
      case 'logs':
        this.deps.showLogs();
        return;
      case 'proxySettings':
        await this.deps.openProxySettings();
        return;
      case 'keyRefresh':
        await this.deps.refreshPinnedProjects();
        return;
      case 'keySettings':
        await this.deps.openPinnedProjectSettings();
        return;
      default:
        return;
    }
  }
}
