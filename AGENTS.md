# HEXCORE2.0 协作钩子

本项目所有回复、解释、代码注释均使用简体中文。

## 任务完成后置钩子

每次完成一个开发任务后，必须执行以下后置流程：

1. 运行本地门禁：
   - 普通任务运行 `npm run post-task -- --status=<complete|incomplete>`
   - 若任务有专用文档，运行 `npm run post-task -- --doc=<任务文档路径> --status=<complete|incomplete>`
   - 钩子会自动读取任务文档、运行 `npm test`、运行 `git diff --check`，并提取验收项、推荐顺序和阻断线索。
2. 检查当前计划是否完成：
   - 若本轮计划已完成，使用 Codex Security 的 `security-scan` 技能审查全量项目代码。
   - 对安全审查发现的问题，使用 Codex Security 的 `fix-finding` 技能修复并重新验证。
   - 修复和验证通过后，如本轮属于较大改动，提交并推送到 Gitee。
3. 若本轮计划未完成：
   - 继续执行开发计划中的下一步。
   - UI、交互、浏览器验证相关任务使用 Build Web Apps 的前端调试/测试流程。
   - 每个较大功能点完成后，再使用 Codex Security 技能做代码审查和必要修复。
4. 推送约束：
   - 仅在改动较大、阶段性闭环完成、或用户明确要求时推送。
   - 推送前必须再次通过 `npm test` 和 `git diff --check`。
   - 不提交无关未跟踪文件，尤其是临时设计文档或本地实验产物。

## 完成判定

`complete` 表示当前开发计划的验收项已全部满足，并且本地门禁通过。钩子会把它视为“申请完成”；若任务文档中仍存在未勾选清单、环境阻断、待处理、尚未完成、等待用户、失败、TODO 等线索，钩子必须失败退出。
`incomplete` 表示还有计划项未完成，必须继续按开发计划推进。

如果完成状态无法从代码和文档中可靠判断，默认按 `incomplete` 处理，继续执行下一项，而不是提前推送。

## 阵营锁定实施循环钩子

执行 `docs/14_阵营锁定10队金币商店模式_实施规范.md` 时，必须使用专用循环钩子：

```powershell
npm run camp-loop -- --status=incomplete
```

当且仅当 14 号文档的推荐执行顺序和验收标准全部完成时，才允许使用：

```powershell
npm run camp-loop -- --status=complete
```

每轮循环必须重新读取 14 号文档，加载 Build Web Apps 技能继续实施，并在阶段完成后使用 Codex Security 审查和修复。`camp-loop` 会自动运行本地门禁并提取 14 号文档中的验收、推荐顺序和阻断线索；计划完成后必须使用 Codex Security 与 Build Web Apps 联合审查，修复问题，更新文档和执行记录，再提交并推送 Gitee。
