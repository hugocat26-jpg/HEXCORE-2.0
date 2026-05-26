# HEXCORE 2.0 多人端副本

本目录是多人实时系统在当前 Git worktree 内的应用目录。当前 worktree 位于 `E:\only_why\HEXCORE2.0\multiplayer`，跟踪 GitHub 分支 `codex/multiplayer-realtime`；同级 `E:\only_why\HEXCORE2.0\hex-core2.0` 继续作为裁判端仓库使用。

当前结构：

```text
E:\only_why\HEXCORE2.0\
├─ hex-core2.0\     裁判端仓库
└─ multiplayer\     多人端 Git worktree，跟踪 codex/multiplayer-realtime
   └─ apps\multiplayer\
```

多人端日常开发直接在 `E:\only_why\HEXCORE2.0\multiplayer` 这个 Git worktree 内完成。开发完成后不再需要额外同步脚本，直接运行测试、提交并推送当前分支。

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

提交前必须运行：

```powershell
npm test
git diff --check
```

验证通过后再提交并推送 `codex/multiplayer-realtime`。

开发约束：

- 多人端 UI、状态和服务端接入优先改当前 worktree 内的多人端目录及专用脚本。
- 不直接修改根目录裁判端运行入口，除非是明确需要同步的通用修复。
- 每次多人端开发完成后，直接在当前 worktree 中提交并推送 GitHub 多人端分支。
- 后续引入服务端权威、队长端和观众端时，在本副本基础上继续拆分。
