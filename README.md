# Payloader

Payloader 是一个面向安全研究与授权测试场景的本地安全知识工作台。前台提供载荷、工具命令、全局检索、变量替换、编解码和离线客户端下载；管理端负责内容、导航、配置、导入导出、默认数据恢复和客户端发布。

当前系统不是纯静态站点。生产运行时由 Node.js 同时提供 React 前端、管理端、公共 API、SQLite 数据和客户端构建状态。

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
- 重置前必须先生成一致性 SQLite 备份，备份失败则不执行删除。
- 客户端下载只指向最后一次成功发布；失败任务单独记录，不覆盖可下载版本。
- `/api/health` 只检查进程存活，`/api/ready` 会检查数据库是否可用。

## 环境要求

- Node.js 22.13 或更高版本
- npm 10 或更高版本
- 构建桌面客户端时，需要目标平台支持的 Electron Builder 工具链

## 本地开发

```powershell
npm ci
npm run admin
```

管理/API 服务默认监听 `http://127.0.0.1:8081`。另开终端启动 Vite：

```powershell
npm run dev
```

开发前端位于 `http://127.0.0.1:5173`，Vite 会把 `/api` 和 `/admin` 代理到 Node 服务。

## 生产运行

```powershell
npm ci
npm run build
$env:PAYLOADER_ADMIN_USER = 'admin'
$env:PAYLOADER_ADMIN_PASSWORD = 'Change-Me-2026!'
$env:PAYLOADER_HOST = '0.0.0.0'
npm start
```

默认生产端口为 `8081`：

- 前台：`http://127.0.0.1:8081/`
- 管理端：`http://127.0.0.1:8081/admin/`
- 存活检查：`GET /api/health`
- 就绪检查：`GET /api/ready`

首次启动会把初始管理员凭据以 scrypt 哈希写入运行时数据库。此后环境变量不会覆盖数据库内已经保存的管理员凭据。

## 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PAYLOADER_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `PAYLOADER_PORT` | `8081` | HTTP 监听端口 |
| `PAYLOADER_DATA_DIR` | `./data` | 运行库、备份、上传和客户端产物目录 |
| `PAYLOADER_SEED_DB` | `./server/default-seed.sqlite` | 默认数据基线 |
| `PAYLOADER_CLIENT_CACHE_DIR` | 数据目录下的客户端构建缓存 | Electron 打包工具缓存；Docker 默认使用可执行的临时目录 |
| `PAYLOADER_ADMIN_USER` | 本机回环模式为 `admin` | 首次启动管理员用户名；生产或非回环监听必须显式设置 |
| `PAYLOADER_ADMIN_PASSWORD` | 本机回环模式为 `payloader-admin` | 首次启动管理员密码；生产或非回环监听必须显式设置强密码 |
| `PAYLOADER_JWT_SECRET` | 自动生成到数据目录 | 管理会话签名密钥 |
| `PAYLOADER_COOKIE_SECURE` | `false` | HTTPS 反向代理后设为 `true` |
| `PAYLOADER_ADMIN_SESSION_TTL_MS` | 8 小时 | 管理会话有效期 |

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
docker build -t payloader:local .
docker volume create payloader-data
docker run --detach --name payloader `
  --publish 8081:8081 `
  --mount source=payloader-data,target=/app/data `
  --env PAYLOADER_ADMIN_USER=admin `
  --env PAYLOADER_ADMIN_PASSWORD=Change-Me-2026! `
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
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

HTTPS 部署时设置 `PAYLOADER_COOKIE_SECURE=true`。健康检查使用 `/api/health`，流量切换与发布就绪检查使用 `/api/ready`。

## 客户端发布

管理端可以生成离线 Electron 客户端。发布元数据分为：

- `latest.json`：最后一次成功且允许下载的发布。
- `last-failure.json`：最后一次失败任务，不影响已有下载。

状态接口会比较当前前端源码和公共数据哈希。旧成功包仍可保留，但界面会明确标记为 stale，直到新包成功生成。

生产镜像直接复用镜像构建阶段验证过的前端产物，不在运行容器内改写应用源码。运行层保留 `electron-builder`，但不携带预下载的 Electron 本体；首次生成某个目标客户端时会在独立工具缓存中下载对应工具链。Docker 默认把该缓存放在 `/tmp`，应用数据卷可以保持 `noexec`；如需跨容器复用缓存，应通过 `PAYLOADER_CLIENT_CACHE_DIR` 指向单独且可执行的缓存卷。

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
