# Castor 开发模块速查图

> 目标：当你要改某个功能时，快速定位「前端入口 + 后端实现 + 关键命令/事件」。

## 1) 总体调用链

1. React 页面触发 `invoke(...)`
2. Tauri `commands.rs` 暴露命令
3. Rust 业务模块执行（`ssh` / `sftp` / `localfs` / `profiles`）
4. Rust 通过事件回推前端（`ssh-output` / `sftp-transfer-progress`）
5. 前端 `listen(...)` 更新 UI 状态

## 2) 按功能定位

| 功能 | 前端入口 | 后端入口 | 关键命令/事件 |
| --- | --- | --- | --- |
| SSH 连接与会话 | `src/App.tsx`, `src/components/WorkspaceView.tsx`, `src/components/TerminalView.tsx` | `src-tauri/src/ssh/mod.rs` | `connect_ssh`, `disconnect_ssh`, `send_ssh_input`, `resize_ssh`, `ssh-output` |
| 本地终端 | `src/App.tsx`, `src/components/TerminalView.tsx` | `src-tauri/src/ssh/mod.rs` | `connect_local_terminal`, `disconnect_ssh`, `ssh-output` |
| 服务器配置管理 | `src/components/ServersView.tsx`, `src/components/ServerEditorModal.tsx`, `src/components/QuickConnectModal.tsx` | `src-tauri/src/profiles.rs` | `list_connection_profiles`, `upsert_connection_profile`, `delete_connection_profile`, `test_ssh_connection` |
| SFTP 列表/浏览 | `src/App.tsx`, `src/components/SftpView.tsx` | `src-tauri/src/sftp.rs` | `sftp_list_dir` |
| 上传（含冲突策略） | `src/App.tsx`, `src/components/LocalUploadConflictDialog.tsx`, `src/app/hooks/useSystemDropUploadQueue.ts` | `src-tauri/src/sftp.rs` | `sftp_upload_path`, `cancel_sftp_transfer`, `sftp-transfer-progress` |
| 下载 | `src/App.tsx`, `src/components/SftpView.tsx` | `src-tauri/src/sftp.rs` | `sftp_download_file`, `cancel_sftp_transfer`, `sftp-transfer-progress` |
| 本地文件操作 | `src/App.tsx`, `src/components/LocalActionDialog.tsx`, `src/components/LocalContextMenu.tsx` | `src-tauri/src/localfs.rs` | `list_local_dir`, `local_rename_entry`, `local_delete_entry`, `local_create_dir` |
| 远程文件操作 | `src/App.tsx`, `src/components/SftpActionDialog.tsx`, `src/components/SftpContextMenu.tsx` | `src-tauri/src/sftp.rs` | `sftp_rename_entry`, `sftp_delete_entry`, `sftp_create_dir`, `sftp_set_permissions` |
| 任务进度面板 | `src/components/TransferTasksPanelModal.tsx`, `src/app/hooks/useTransferProgressManager.ts` | `src-tauri/src/sftp.rs` | `sftp-transfer-progress` |

## 3) 关键状态归属（前端）

- 全局编排状态：`src/App.tsx`
- SFTP 任务状态（运行中/已完成 + ETA/速度）：`src/app/hooks/useTransferProgressManager.ts`
- 系统拖拽上传队列与去重：`src/app/hooks/useSystemDropUploadQueue.ts`
- 类型契约（前后端请求响应）：`src/types.ts`

## 4) 关键后端模块职责

- `src-tauri/src/commands.rs`：对外命令路由层（thin wrapper）
- `src-tauri/src/ssh/mod.rs`：SSH 会话与本地 PTY 生命周期、输入输出、resize、状态事件
- `src-tauri/src/sftp.rs`：SFTP 目录操作、递归上传下载、冲突策略、权限、进度与取消
- `src-tauri/src/localfs.rs`：本地目录浏览/重命名/删除/建目录
- `src-tauri/src/profiles.rs`：配置文件持久化（`connection_profiles.json`）

## 5) 常见改动场景速查

| 场景 | 优先改动文件 |
| --- | --- |
| 调整终端交互（输入/resize/状态） | `src/components/TerminalView.tsx`, `src-tauri/src/ssh/mod.rs` |
| 调整上传下载进度显示 | `src/app/hooks/useTransferProgressManager.ts`, `src/components/TransferTasksPanelModal.tsx`, `src/App.tsx` |
| 新增 SFTP 操作命令 | `src-tauri/src/sftp.rs`, `src-tauri/src/commands.rs`, `src/types.ts`, `src/App.tsx` |
| 调整服务器配置字段 | `src/components/ServerEditorModal.tsx`, `src/types.ts`, `src-tauri/src/profiles.rs` |
| 优化 SFTP 列表 UI 或交互 | `src/components/SftpView.tsx`, `src/styles/app.css`, `src/App.tsx` |

