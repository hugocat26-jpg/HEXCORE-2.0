# HEXCORE2.0 文档目录

更新时间：2026-05-30

本目录保留项目协作、产品规则、架构设计、开发计划、部署运维和用户交付所需的源文档。当前采用“分目录维护 + `docs/06_开发计划.md` 兼容入口”的结构。

## 快速入口

| 需要了解 | 阅读文档 |
| --- | --- |
| 当前项目是什么 | [product/产品总览.md](product/产品总览.md) |
| 当前待开发事项 | [planning/当前待开发计划.md](planning/当前待开发计划.md) |
| 每轮完成前的门禁 | [planning/开发门禁.md](planning/开发门禁.md) |
| 已完成范围摘要 | [planning/已完成开发记录.md](planning/已完成开发记录.md) |
| 详细执行流水 | [planning/执行记录.md](planning/执行记录.md) |
| 裁判端规则流程 | [product/裁判代执行流程.md](product/裁判代执行流程.md) |
| 阵营锁定金币商店规则 | [product/阵营锁定10队金币商店模式实施规范.md](product/阵营锁定10队金币商店模式实施规范.md) |
| 系统架构 | [architecture/系统架构.md](architecture/系统架构.md) |
| 数据模型 | [architecture/数据模型.md](architecture/数据模型.md) |
| 多人端部署 | [multiplayer/多人端部署运维说明.md](multiplayer/多人端部署运维说明.md) |
| 腾讯云宝塔部署 | [multiplayer/腾讯云宝塔大陆部署说明.md](multiplayer/腾讯云宝塔大陆部署说明.md) |
| Win11 客户安装 | [user-guides/Win11_Docker_PostgreSQL_安装说明.md](user-guides/Win11_Docker_PostgreSQL_安装说明.md) |

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `planning/` | 当前计划、门禁、已完成摘要、执行记录和历史归档。 |
| `product/` | 产品口径、业务流程、角色权限和规则实施规范。 |
| `architecture/` | 架构、数据模型、引擎设计、技术评估和 UI 规范。 |
| `multiplayer/` | 多人端房间 UX、局域网/Docker/宝塔部署和运维说明。 |
| `operations/` | 任务钩子、旧数据导入等维护操作说明。 |
| `user-guides/` | 面向用户、裁判或发布阅读的 Word 交付文档。 |

## 兼容说明

- `docs/06_开发计划.md` 保留为旧命令兼容入口，内部链接到新的 `planning/` 文档。
- `scripts/task-loop-runner.js` 和 `scripts/post-task-hook.js` 默认读取 [planning/当前待开发计划.md](planning/当前待开发计划.md)。
- 新任务建议直接维护 [planning/当前待开发计划.md](planning/当前待开发计划.md)，完成后把摘要迁入 [planning/已完成开发记录.md](planning/已完成开发记录.md)，详细过程追加到 [planning/执行记录.md](planning/执行记录.md)。
- `user-guides/` 下的 `.docx` 是交付产物，不作为开发源文档的唯一权威来源。

## 外部产物

- `../CHANGELOG.md`：版本更新记录；每次版本号变化和 GitHub 推送前必须同步维护。
- `../output/pdf/`：由脚本生成的 PDF 发布资料。
- `../output/release/`：本地打包发布产物，不作为源文档维护。
