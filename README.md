# Payloader

Payloader 是一个面向安全研究与授权测试场景的本地安全知识工作台。前台提供载荷、工具命令、全局检索、变量替换、编解码和离线客户端下载；管理端负责内容、导航、配置、导入导出、默认数据恢复和客户端发布。

当前系统不是纯静态站点。生产运行时由 Node.js 同时提供 React 前端、管理端、公共 API、SQLite 数据和客户端构建状态。

## Xeye XSS 平台

Payloader 默认在公开前端提供 [Xeye XSS 平台](https://xss.icu/)入口。公网部署的原始 HTML、React 顶部入口、工具导航和生成客户端使用同一固定地址；部署管理员可以在后台工具列表中删除该入口，删除后所有公开展示与搜索元数据同步移除，重置默认工具可恢复。

## GitHub 项目归属保护

GitHub 项目地址固定且不可通过后台、导入或客户端构建覆盖。目标地址以 AES-256-GCM 密文和分片密钥材料保存在独立保护模块中，运行时代码、公开 JSON 和前端构建包不保存明文地址。Web 前端只接收站内不透明路径，由 Node 服务在点击时解密并跳转；Electron 前端只接收 `payloader://project`，由主进程验证并打开目标。

服务端加载、客户端生成和 Electron 启动会校验 GCM 认证标签与目标 SHA-256；密文、IV、认证标签、密钥片段或恢复结果被删除或篡改时会直接失败。`npm run verify:attribution` 还会扫描运行时源码、默认种子和生产 `dist`，发现明文地址即阻止构建。此规则与可由管理员删除的 Xeye 入口相互独立。

## 运行架构

```text
Browser
  |-- /                         React/Vite production bundle
  |-- /admin/                   Admin HTML/CSS/JavaScript
  |-- /api/public-data          Public content snapshot
  |-- /api/client-build         Last successful client release state
  `-- /api/admin/*              Authenticated administration API
             |
             `-- data/payloader.sqlite
                   |
                   `-- data/backups/

server/default-seed.sqlite      Validated reset baseline
```

核心边界：

- `data/payloader.sqlite` 是可变的运行时权威数据库。
- `server/default-seed.sqlite` 是经过内容质量验证的默认恢复基线。
- `npm run build:seed` 默认从现有验证基线做确定性重建；`--from-legacy-src-data` 仅用于显式导入旧版 `src/data`，导入后仍须重新执行内容审校与 `npm run check`，不能作为当前权威源。
- 重置前必须先生成一致性 SQLite 备份，备份失败则不执行删除。
- 客户端下载只指向最后一次成功发布；失败任务单独记录，不覆盖可下载版本。
- `/api/health` 只检查进程存活，`/api/ready` 会检查数据库是否可用。
- `/api/public-data` 在数据变更时预生成 JSON、ETag、gzip 和 brotli 快照；普通请求直接复用压缩 Buffer，未变更请求返回 `304`。
- 管理端自定义内容使用受鉴权的小型接口，不再为了少量记录重复下载完整公开数据集。
- 收到 `SIGINT` 或 `SIGTERM` 时，服务先停止接收请求，再关闭 SQLite 资源。

## 环境要求

- Node.js 22.13 或更高版本
- npm 10 或更高版本
- 发布官方客户端壳时，需要 GitHub Actions 的 Windows、Linux、macOS 原生 Runner

## 本地开发

```powershell
npm ci
$bytes = [byte[]]::new(32)
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$env:PAYLOADER_ADMIN_USER = 'admin'
$env:PAYLOADER_ADMIN_PASSWORD = "Pw!$([Convert]::ToBase64String($bytes))"
npm run admin
```

首次生成的密码需要保存到本机密码管理器；已经初始化的数据库应在后台“账号安全”中修改密码，环境变量不会覆盖已保存的凭据。仅自动化测试可在开发环境、回环监听时显式设置 `PAYLOADER_ALLOW_INSECURE_DEV_CREDENTIALS=true`，普通开发和部署不要启用。

管理/API 服务默认监听 `http://127.0.0.1:8081`。另开终端启动 Vite：

```powershell
npm run dev
```

开发前端位于 `http://127.0.0.1:5173`，Vite 会把 `/api` 和 `/admin` 代理到 Node 服务。

## 生产运行

```powershell
npm ci
npm run build
$bytes = [byte[]]::new(32)
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$env:PAYLOADER_ADMIN_USER = 'admin'
$env:PAYLOADER_ADMIN_PASSWORD = "Pw!$([Convert]::ToBase64String($bytes))"
$env:PAYLOADER_HOST = '0.0.0.0'
npm start
```

默认生产端口为 `8081`：

- 前台：`http://127.0.0.1:8081/`
- 管理端：`http://127.0.0.1:8081/admin/`
- 存活检查：`GET /api/health`
- 就绪检查：`GET /api/ready`

首次启动会把初始管理员凭据以 scrypt 哈希写入运行时数据库。所有正常启动都要求显式凭据，内置默认密码和文档示例密码会被拒绝。此后环境变量不会覆盖数据库内已经保存的管理员凭据。

从仍使用旧版公开默认密码的实例升级时，服务会拒绝启动。为该实例显式设置一次新的强 `PAYLOADER_ADMIN_USER` 和 `PAYLOADER_ADMIN_PASSWORD` 后重新启动，系统只在确认已保存密码属于公开旧值时执行一次性迁移；迁移成功后可移除这两个环境变量。正常的已有强凭据不会被环境变量覆盖。

管理端登录返回带服务端撤销状态的 Bearer JWT。浏览器只把令牌保存在当前标签页的 `sessionStorage`，每次管理 API 请求通过 `Authorization: Bearer ...` 显式发送；系统不使用 Cookie 进行管理员身份认证。

## 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PAYLOADER_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `PAYLOADER_PORT` | `8081` | HTTP 监听端口 |
| `PAYLOADER_DATA_DIR` | `./data` | 运行库、备份、上传和客户端产物目录 |
| `PAYLOADER_SEED_DB` | `./server/default-seed.sqlite` | 默认数据基线 |
| `PAYLOADER_CLIENT_CACHE_DIR` | 数据目录下的客户端构建缓存 | 官方壳、Electron 和 Builder 缓存；Docker 默认使用可执行的临时目录 |
| `PAYLOADER_CLIENT_SHELL_DIR` | 空 | 本地官方壳目录；配置后优先读取其中的固定清单，适合离线部署 |
| `PAYLOADER_CLIENT_SHELLS_REMOTE_DISABLED` | `false` | 设为 `true` 时禁止从固定官方 GitHub Release 检查和下载壳 |
| `PAYLOADER_ADMIN_USER` | 无 | 首次启动管理员用户名，必须显式设置 |
| `PAYLOADER_ADMIN_PASSWORD` | 无 | 首次启动高强度管理员密码，必须显式设置且不能使用公开示例值 |
| `PAYLOADER_JWT_SECRET` | 自动生成到数据目录 | 管理会话签名密钥 |
| `PAYLOADER_ADMIN_SESSION_TTL_MS` | 8 小时 | 管理会话有效期 |
| `PAYLOADER_TRUSTED_PROXIES` | 空 | 可信反向代理 IP，逗号分隔；同机 Nginx 可使用 `loopback` |
| `PAYLOADER_ALLOW_INSECURE_DEV_CREDENTIALS` | `false` | 仅回环开发自动化可显式启用的旧默认凭据开关 |
| `PAYLOADER_VERSION` | `package.json` 版本 | 可选的当前部署版本覆盖值；当前项目版本为 `2.0.0` |
| `PAYLOADER_COMMIT_SHA` | 本地 Git HEAD | 当前部署的源码提交号；不可用时源码通道显示未知 |
| `PAYLOADER_GITHUB_TOKEN` | 空 | 服务端专用 GitHub API Token，不返回前端且不进入客户端构建链 |
| `PAYLOADER_UPDATE_CHECK_INTERVAL_MS` | 6 小时 | 自动版本检查间隔，允许 15 分钟到 7 天 |
| `PAYLOADER_UPDATE_CHECK_DISABLED` | `false` | 设为 `true` 时关闭定时检查，但保留后台手动检查 |
| `PAYLOADER_ELECTRON_MIRROR` | 官方上游 | 可选 Electron 下载镜像；只有受信镜像才应配置 |
| `PAYLOADER_ELECTRON_BUILDER_BINARIES_MIRROR` | 官方上游 | 可选 Builder helper 镜像；只有受信镜像才应配置 |

## 系统更新

管理后台“系统更新”模块只读检查固定官方 GitHub 仓库，不接受管理员输入仓库地址，也不会自动下载、覆盖或执行远端内容。

- 稳定版本通道依次读取最新正式 Release、最高稳定语义化标签、远端 `package.json` 版本。
- 源码通道比较当前部署提交与官方默认分支最新提交，区分同步、远端领先、本地领先和分支差异。
- 后台默认每 6 小时检查一次，使用 ETag 条件请求；“立即检查”与定时任务共享同一个执行中的请求。
- GitHub 暂时不可用或触发限额时保留上次成功结果，并显示下一次计划检查时间。
- 无 Release、无语义化标签且远端仍为 `0.0.0` 时，后台显示“尚未正式发布”，该占位值不参与版本高低比较。

公开部署建议发布 GitHub Release 或 `v2.0.0` 这类稳定标签。匿名 GitHub API 配额不足时可设置只读、最小权限的 `PAYLOADER_GITHUB_TOKEN`；该值只供 Node 服务请求 GitHub API 使用。

## 数据备份与恢复

管理端提供以下受保护操作：

- `GET /api/admin/export`：导出当前内容包 JSON。
- `GET /api/admin/reset-impact?target=...`：预览重置影响。
- `POST /api/admin/reset-defaults`：备份成功后再执行重置，并返回前后计数与备份信息。

自动备份位于 `data/backups/`。恢复 SQLite 备份时先停止服务，再保留当前数据库并替换：

```powershell
Stop-Process -Name node
Copy-Item -LiteralPath 'data\payloader.sqlite' -Destination 'data\payloader.sqlite.before-restore'
Copy-Item -LiteralPath 'data\backups\<backup-file>.sqlite' -Destination 'data\payloader.sqlite' -Force
npm start
```

恢复后应确认：

```powershell
Invoke-RestMethod 'http://127.0.0.1:8081/api/ready'
Invoke-RestMethod 'http://127.0.0.1:8081/api/public-data'
```

## Docker

镜像运行完整 Node 应用，并把 `/app/data` 声明为持久卷：

```powershell
$commit = (git rev-parse HEAD).Trim()
docker build --build-arg "PAYLOADER_COMMIT_SHA=$commit" -t payloader:local .
docker volume create payloader-data
$bytes = [byte[]]::new(32)
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$adminPassword = "Pw!$([Convert]::ToBase64String($bytes))"
docker run --detach --name payloader `
  --publish 8081:8081 `
  --mount source=payloader-data,target=/app/data `
  --env PAYLOADER_ADMIN_USER=admin `
  --env "PAYLOADER_ADMIN_PASSWORD=$adminPassword" `
  payloader:local
```

容器以非 root 用户运行。首次生产启动若未显式提供管理员账号和强密码，进程会在监听端口前失败退出；升级镜像时复用同一个数据卷，不要把运行库烘焙进镜像。

## 反向代理

生产域名应把全部路径转发给 Node 服务，而不是只托管 `dist/`。Nginx 最小示例：

```nginx
server {
    listen 443 ssl http2;
    server_name payloader.example.com;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

同机 Nginx 反代时，在启动 Node 服务前设置 `PAYLOADER_TRUSTED_PROXIES=loopback`。应用只有在 TCP 对端匹配可信代理配置时才读取 `X-Forwarded-For`，否则始终使用直连地址，防止伪造代理头绕过登录限速。健康检查使用 `/api/health`，流量切换与发布就绪检查使用 `/api/ready`。

当前管理员会话和限速桶属于单进程内存状态。默认部署应保持单实例；如果需要水平扩展，先把会话与限速迁移到共享存储，并在应用中显式配置可信代理边界，不能只依赖 `X-Forwarded-For`。

## 客户端发布

管理端可以生成离线 Electron 客户端。发布元数据分为：

- `latest.json`：最后一次成功且允许下载的发布。
- `last-failure.json`：最后一次失败任务，不影响已有下载。

状态接口会比较当前前端源码和公共数据哈希。旧成功包仍可保留，但界面会明确标记为 stale，直到新包成功生成。

客户端由“官方程序壳”和“部署公开数据包”组成。`.github/workflows/client-shells.yml` 在 `windows-latest`、`ubuntu-latest`、`macos-latest` 上原生构建 9 个平台/架构壳，合并 `payloader-client-shells.json`，并在 `v*` 标签对应的 GitHub Release 发布。Linux 部署不编译 Windows 或 macOS 二进制，只下载固定官方仓库中的 SHA-256 绑定壳，安全解包后替换 `deployment.payloader`，最后输出 Windows ZIP 或 Linux/macOS TAR.GZ。

每个 Release 壳都带一份由 `server/default-seed.sqlite` 导出的默认 `deployment.payloader`，因此官方制品直接下载也有初始数据。部署后台生成客户端时会替换为该实例当前的公开数据、公开自定义工具和 Logo。数据包明确排除管理员凭据、JWT 材料、环境变量、SQLite、备份和私有上传。

远程壳地址不能在后台修改。服务只读取固定官方 GitHub Release，并要求应用版本、构建 contract 和数据包版本全部匹配；下载使用大小上限、超时、SHA-256、原子缓存和并发合并。离线环境可把完整 Release 文件放入只读目录并设置 `PAYLOADER_CLIENT_SHELL_DIR`。`PAYLOADER_CLIENT_CACHE_DIR` 应挂载为独立持久缓存卷；官方壳按哈希缓存，不需要 Wine、Xcode 或 macOS 工具链。

如果某个官方壳尚未发布，当前宿主仍可使用原有 Electron Builder 生成本机支持的安装包。生产镜像保留该原生回退能力，但不携带 Wine、macOS 工具链、预下载 Electron、签名证书或公证凭据。

TypeScript、Vite 和 Electron Builder 子进程只接收操作系统、缓存、代理、受信镜像和显式签名变量白名单。管理员密码、JWT 密钥、数据目录以及 GitHub/云凭据不会继承到客户端构建链。

所有平台客户端共享同一份 Electron 离线运行模板。模板优先发现可执行文件旁的 `deployment.payloader`，校验 contract、路径、文件大小和 SHA-256 后流式提供公共数据与静态资源；旧版内嵌数据只作为迁移回退。模板启用后台节流、V8 code cache 和单实例锁。客户端性能契约版本为 `7`；更早的成功包会保留但标记为 stale，需重新生成后才能作为当前版本发布。

前台搜索使用 120 ms 输入防抖、React 延迟更新和共享匹配结果，避免 Sidebar 与主内容区重复扫描；不持久化正文副本，控制 Electron 常驻内存。

原生性能烟测会验证完整公共数据、搜索交互、单实例、首窗时间、空闲 CPU、工作集和重复搜索后的私有内存增长：

```powershell
npm run verify:client-performance
```

Windows 指标可在 Windows 构建机直接测量。CI 还会在 `windows-latest`、`ubuntu-latest` 和 `macos-latest` 分别启动对应系统的 Electron 运行时执行同一烟测；在对应 runner 成功前，不应把某个平台标记为已完成原生性能验收。安装包签名、macOS notarization 和特定 ARM 设备兼容性仍需在目标发布环境完成。

手动构建当前 Runner 的壳：

```powershell
$env:PAYLOADER_CLIENT_SHELL_TARGETS = 'win-x64-nsis,win-arm64-nsis,win-ia32-nsis'
npm run build
npm run build:client-shells
```

GitHub Actions 手动运行只保留 Actions 制品；推送 `v2.0.0` 这类标签才创建或更新对应 Release。Windows/macOS 签名材料只配置在官方仓库 Actions secrets 中，部署服务器不需要也不会获得这些材料。

## 质量门禁

```powershell
npm run check
```

聚合门禁依次执行：

1. TypeScript 类型检查
2. ESLint
3. 编解码回归向量
4. SQLite 内容质量验证
5. Node 单元与 API 冒烟测试
6. 生产构建

单独命令：

```powershell
npm run typecheck
npm run lint
npm run verify:codec
npm run verify:content
npm run verify:client-performance
npm test
npm run build
```

内容修复脚本默认 dry-run；只有显式 `--apply` 才能写库，并且写入前会创建任务级完整性备份。CI 在 Node.js 22 上运行同一套 `npm run check`。

## 目录

| 路径 | 说明 |
| --- | --- |
| `src/` | React 前端与内置静态内容来源 |
| `admin/` | 管理端页面与脚本 |
| `server/` | Node HTTP、SQLite 与客户端发布逻辑 |
| `scripts/` | 数据构建、内容审计与编解码验证 |
| `tests/` | Node 测试与运行时契约测试 |
| `data/` | 可变运行数据，不进入版本库 |
| `server/default-seed.sqlite` | 经验证的默认种子数据库 |
