# CodeOps Panel VS Code Extension

CodeOps Panel 是一个运行在 VS Code UI Host 侧的本地工作台扩展。当前包含两类能力：

- `Reverse Tunnel Proxies`：管理 SSH 反向隧道（`ssh -N -R`）。
- `Pinned Projects`：从统一 CodeOps Panel 配置文件中读取重点项目列表，并展示每个 Git 仓库的分支、同步状态和工作区干净程度。

## 主要功能

### Reverse Tunnel Proxies

- 在侧边栏 `CodeOps Panel` -> `Reverse Tunnel Proxies` 中逐行开关多个远端隧道
- 状态栏显示已启动 remote 数量
- 内置日志入口（`Open Logs`）
- 内置配置入口（`Settings`）
- 启动前自动检查本机 `ssh` 命令可用性
- 远端端口占用时给出明确错误提示
- 支持在 remote-ssh 窗口中使用，SSH 进程始终在本地笔记本（UI Host）运行

### Pinned Projects

- 在侧边栏 `CodeOps Panel` -> `Pinned Projects` 中查看重点项目状态
- 支持本地仓库和 SSH 远端仓库两种模式
- `Refresh` 会执行 `git fetch --prune --quiet` 和 `git status --porcelain=v2 --branch`
- 展示 clean/dirty、synced/ahead/behind/diverged/no upstream 等状态
- 点击项目行可查看详细状态输出
- 未刷新前先显示配置里的 repo name，刷新后补充分支、远端同步和工作区状态

## 交互说明

### 状态栏

- `ReverseTun n/m`：展示已启动 remote 数量；点击只弹出当前状态，不执行 start/stop。
- `Pinned Projects`：展示重点项目汇总；点击触发刷新。

### 侧边栏

Activity Bar 图标：`CodeOps Panel`
视图名称：`CodeOps Panel`

分组：

- `Reverse Tunnel Proxies`
- `Pinned Projects`

顶部工具栏：

- `Bootstrap`：用交互式初始化向导生成统一配置文件
- `Logs`：打开扩展输出日志
- `Settings`：打开/创建统一配置文件

`Reverse Tunnel Proxies` 表格行为：

- `Proxy`：显示状态图标、`remoteHost:remotePort` 和详情浮层入口
- `Action`：插件管理的 remote 可逐行 `Start` / `Stop`
- 外部已存在的 tunnel 显示为 `Started`，但不可从插件停止

`Pinned Projects` 表格行为：

- `Repo`：展示仓库显示名
- `Branch`：展示当前分支
- `Remote`：展示 upstream 同步状态
- `State`：展示 clean/dirty/unavailable
- `Refresh`：刷新全部配置仓库状态

## CodeOps Panel 配置

扩展设置只保留 1 项：

- `myToolbox.configFile`（默认：`.vscode/mytoolbox.config.json`）

该设置指向整个插件的 JSON 配置文件路径。默认值是 workspace 级本地配置 `.vscode/mytoolbox.config.json`，通常不进入 Git。若为相对路径：本地窗口优先按工作区解析，remote-ssh 窗口按本地用户目录解析；若未命中，则回退到扩展内置 `resources/mytoolbox.config.json`。

配置文件同时包含 `ReverseTunnel` 和 `keyProjects` 两个顶层节点：

```json
{
  "ReverseTunnel": {
    "sshPath": "ssh",
    "connectionReadyDelayMs": 1200,
    "localHost": "127.0.0.1",
    "localPort": 7897,
    "remotes": [
      {
        "remoteHost": "FOO_ADDRESS",
        "remotePort": 4001,
        "remoteUser": "FOO_USER",
        "remoteBindPort": 17897,
        "identityFile": ""
      }
    ]
  },
  "keyProjects": {
    "mode": "local",
    "rootDir": "E:/projects",
    "repoNames": ["MyToolBox", "another-project"],
    "sshTarget": "",
    "sshPort": 22,
    "gitPath": "git",
    "sshPath": "ssh"
  }
}
```

等价 SSH 命令：

```bash
ssh -N -p 4001 -R 17897:127.0.0.1:7897 FOO_USER@FOO_ADDRESS
```

### Settings 按钮行为

当 `myToolbox.configFile` 指向的文件不存在时：

1. 按当前设置值解析目标路径；如果设置未显式填写，则使用默认 `.vscode/mytoolbox.config.json`
2. 提供 `Create default config` 和 `Run bootstrap wizard` 两个选项
3. 选择默认配置时，在目标路径创建示例配置文件（带默认模板）
4. 选择初始化向导时，按对话输入生成 `ReverseTunnel` 和 `keyProjects`
5. 自动更新 `myToolbox.configFile` 到该文件绝对路径并打开文件

### Bootstrap 初始化向导

Bootstrap 使用 VS Code 原生输入框逐步收集：

- Reverse Tunnel：`localHost:localPort`、零个或多个 remote 的地址/端口/用户名/绑定端口
- Pinned Projects：`local` 或 `ssh` 模式、SSH 目标（仅 SSH 模式）、`rootDir`、零个或多个 `repoNames`
- `local` 模式下 `rootDir` 使用文件夹选择器；`ssh` 模式下 `rootDir` 作为远端路径手动输入

若目标配置文件已存在，Bootstrap 会先确认是否覆盖；取消则不会修改文件。

## Pinned Projects 配置

Pinned Projects 使用统一配置文件中的 `keyProjects` 节点。

字段说明：

- `mode`：`local` 或 `ssh`。非 `ssh` 值会按 `local` 处理。
- `rootDir`：项目根目录。`repoNames` 中的每一项会拼到该目录下；当 `repoNames` 包含 `"."` 时直接使用 `rootDir` 本身。
- `repoNames`：重点项目列表。
- `sshTarget`：SSH 模式下的目标，例如 `user@example.com`。
- `sshPort`：SSH 端口，默认 `22`。
- `gitPath`：本地模式使用的 Git 命令路径，默认 `git`。
- `sshPath`：SSH 模式使用的 SSH 命令路径，默认 `ssh`。

SSH 模式示例：

```json
{
  "keyProjects": {
    "mode": "ssh",
    "rootDir": "/home/user/projects",
    "repoNames": ["service-a", "service-b"],
    "sshTarget": "user@example.com",
    "sshPort": 22,
    "gitPath": "git",
    "sshPath": "ssh"
  }
}
```

在 SSH 模式下，扩展会通过本地 `ssh` 到远端执行 Git 状态检查；远端需要可运行 `git`。

## 本地开发

```bash
npm install
npm run compile
npm test
```

按 `F5` 启动 Extension Development Host。

常用脚本：

- `npm run compile`：编译扩展源码到 `out/`
- `npm run compile-tests`：编译测试源码
- `npm test`：编译并运行 VS Code 扩展测试

## 打包 VSIX

```bash
npm run package:vsix
```

打包脚本会读取 `package.json` 的版本号，并输出类似 `release-artifacts/code-ops-panel-extension-v0.1.vsix` 的文件。

项目约定：代码变更后默认构建 VSIX 供测试；仅文档变更或仅 `media/` 变更可跳过。

## 目录结构

- `src/app.ts`：扩展激活入口和主要业务编排
- `src/reverseTunnel/`：反向隧道配置和服务封装
- `src/pinnedProjects/`：重点项目 Git 状态和 SSH 批处理逻辑
- `src/webview/`：CodeOps Panel 侧边栏 Webview 渲染和消息处理
- `src/shared/`：日志、校验等共享工具
- `test/suite/`：扩展测试和纯函数测试
- `resources/`：默认 CodeOps Panel 配置模板
- `media/`：Activity Bar 图标
