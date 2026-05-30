# Win11 Docker PostgreSQL 安装说明

本文面向拿到客户发布版的裁判或现场管理员。目标是在 Win11 电脑上安装并运行 HEXCORE2 多人端，数据写入本机 Docker PostgreSQL。

## 运行前置

| 项目 | 要求 |
| --- | --- |
| 系统 | Windows 11 x64 |
| Docker | 安装并启动 Docker Desktop |
| 网络 | 首次启动需要联网拉取或构建 Docker 镜像 |
| 权限 | 普通用户可安装到 `%LOCALAPPDATA%\HEXCORE2`；Docker Desktop 自身可能需要管理员或重启 |

安装包不内置 Docker Desktop。若启动脚本提示未检测到 `docker`，可先安装 Docker Desktop：

```powershell
winget install Docker.DockerDesktop
```

安装完成后，打开 Docker Desktop，等待状态变为 Running，再重新启动 HEXCORE2。

## 安装

1. 运行 `HEXCORE2_Setup_v2.0.22.exe`。
2. 安装目录默认使用 `%LOCALAPPDATA%\HEXCORE2`。
3. 保留默认快捷方式：
   - 启动 HEXCORE2
   - 停止 HEXCORE2
   - 打开裁判页面
   - 查看服务日志

首次启动时，脚本会从 `.env.example` 生成本机 `.env`，并自动生成随机 PostgreSQL 密码。该密码只保存在客户电脑本机，不会显示在控制台或写入说明文档。

## 启动

双击“启动 HEXCORE2”。

脚本会依次执行：

1. 检查 Docker Desktop 和 `docker compose`。
2. 如果缺少 Docker，显示安装/启动引导。
3. 如果 `.env` 不存在，生成本机 `.env`。
4. 执行 `docker compose up -d --build`。
5. 访问 `http://127.0.0.1:4196/health`，确认 `runtime.storage` 为 `postgres`。
6. 打开页面 `http://127.0.0.1:4186/`。

## 页面入口

| 使用者 | 地址 |
| --- | --- |
| 裁判本机 | `http://127.0.0.1:4186/` |
| 同一局域网队长 | `http://裁判电脑局域网IP:4186/` |
| 健康检查 | `http://127.0.0.1:4196/health` |

局域网队长访问前，需要确认 Windows 防火墙允许 Docker/Node 相关端口，默认是 `4186` 页面端口和 `4196` API 端口。

## 停止和日志

- “停止 HEXCORE2”：执行 `docker compose down`，只停止容器，保留 PostgreSQL 数据卷。
- “查看服务日志”：查看 `hexcore` 容器最近日志。
- 如需查看数据库容器日志，可在 PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/windows/Show-HEXCORE2-Logs.ps1 -Service postgres
```

不要随意执行 `docker compose down -v`。`-v` 会删除 PostgreSQL 数据卷，赛事数据会丢失。

## 备份

建议每场比赛结束后导出裁判备份，并由管理员保管 PostgreSQL 备份文件。具备 `pg_dump` 工具时可使用：

```powershell
$env:HEXCORE_POSTGRES_URL="postgres://hexcore:本机.env里的密码@127.0.0.1:5432/hexcore"
powershell -ExecutionPolicy Bypass -File scripts/postgres-backup.ps1 -OutputPath E:\hexcore-backup\match.dump
```

连接串只应存在于管理员本机环境变量中，不应截图、发群、写入文档或提交 Git。

## 管理员验收

客户电脑完成 Docker Desktop 安装后，可在安装目录或源码目录运行：

```powershell
npm run verify:docker-postgres
```

该命令用于交付前自检，会验证 Docker Compose、PostgreSQL 存储、12 队无阵营房间、裁判端/队长端/观众端、开店、购买、跳过、SSE 同步、容器重启恢复和 PostgreSQL 备份/恢复。命令通过后，才能说明 Docker PostgreSQL 运行链路已闭环。

## 常见问题

### 提示未检测到 docker

说明 Docker Desktop 未安装，或安装后终端没有刷新环境变量。安装 Docker Desktop 后重启电脑或重新打开终端。

### Docker Desktop 已打开但启动失败

等待 Docker Desktop 完成初始化；如提示 WSL2 未就绪，按 Docker Desktop 的提示完成 WSL2 更新或重启电脑。

### 页面能打开但健康检查不是 postgres

当前没有使用 Docker PostgreSQL 版本。请停止本地 Node 进程，使用“启动 HEXCORE2”快捷方式重新启动。

### 卸载时是否删除数据

卸载安装包不会删除 Docker Desktop。是否删除 PostgreSQL volume 必须由管理员单独确认；删除后赛事数据不可恢复。
