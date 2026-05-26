# HEXCORE 2.0 多人端副本

本目录是多人实时系统的隔离开发副本。后续多人端改动优先在这里推进，根目录裁判端继续保持客户发布版稳定。

本机同时维护一份便于直接开发和查看的多人端工作副本：

```text
E:\only_why\HEXCORE2.0\multiplayer
```

该目录不覆盖 `E:\only_why\HEXCORE2.0\hex-core2.0` 裁判端仓库。多人端日常开发以本机工作副本为准；每次开发完成后，必须同步回 GitHub 多人端分支中的 `apps/multiplayer/`，再测试、提交和推送。

当前副本来源于 `HEXCORE 2.0 v2.0.4` 裁判端：

- `index.html`
- `src/`
- `assets/`

本地启动：

```powershell
npm run start:multiplayer
```

默认访问：

```text
http://127.0.0.1:4186/
```

启动脚本会优先服务 `E:\only_why\HEXCORE2.0\multiplayer`；如果该本机副本不存在，则回退到仓库内 `apps/multiplayer/`。

同步到版本管理副本：

```powershell
npm run sync:multiplayer
```

同步方向固定为：

```text
E:\only_why\HEXCORE2.0\multiplayer -> apps/multiplayer
```

同步完成后必须运行：

```powershell
npm test
git diff --check
```

验证通过后再提交并推送 `codex/multiplayer-realtime`。

开发约束：

- 多人端 UI、状态和服务端接入优先改本目录及多人端专用脚本。
- 不直接修改根目录裁判端运行入口，除非是明确需要同步的通用修复。
- 每次本机多人端开发完成后，先运行 `npm run sync:multiplayer`，再提交 GitHub 多人端分支。
- 后续引入服务端权威、队长端、观众端和大屏端时，在本副本基础上继续拆分。
