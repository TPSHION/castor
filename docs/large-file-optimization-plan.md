# 大文件优化计划

## 已完成（本次）

### SFTP 视图拆分

原始文件：`src/components/SftpView.tsx`（897 行）

本次拆分：
- `src/components/sftp/useSftpDragTransfer.ts`：拖拽与系统拖放逻辑
- `src/components/sftp/TransferProgressCard.tsx`：传输进度卡片渲染
- `src/components/sftp/transferHelpers.ts`：ETA 格式化工具
- `src/components/sftp/types.ts`：SftpViewProps 类型

结果：`src/components/SftpView.tsx` 降至 523 行。

### App 入口拆分

原始文件：`src/App.tsx`（726 行）

本次拆分：
- `src/components/app/AppHeader.tsx`：窗口头部与会话 Tab 交互
- `src/components/app/AppContent.tsx`：页面内容区组装（Servers/SFTP/Workspace）
- `src/components/app/AppOverlays.tsx`：模态层与右键菜单层

结果：`src/App.tsx` 降至 553 行（继续待拆）。

## 当前大文件清单（待继续治理）

- `src/styles/app.css`（2566 行）
- `src/App.tsx`（553 行）
- `src/app/hooks/useSystemdDeploy.tsx`（635 行）
- `src/app/hooks/useTransferOrchestrator.ts`（600 行）
- `src/app/hooks/useNginxServices.tsx`（537 行）
- `src/components/SftpView.tsx`（523 行）
- `src/types.ts`（552 行）

## 分阶段治理建议

### Phase 1（低风险，优先）

- `src/styles/app.css` 按领域拆分：`sftp.css`、`systemd.css`、`nginx.css`、`environment.css`
- `src/App.tsx` 继续拆分业务桥接（SFTP 视图 props 组装与会话编排）
- `src/types.ts` 拆分为 `types/ssh.ts`、`types/sftp.ts`、`types/systemd.ts`、`types/nginx.ts`、`types/runtime.ts`

### Phase 2（中风险）

- `useSystemdDeploy.tsx` 按场景拆分：列表、详情、日志、表单、导入
- `useNginxServices.tsx` 按场景拆分：列表/详情/发现导入/控制
- `useTransferOrchestrator.ts` 拆分：上传流、下载流、冲突策略、事件监听

## 规则

- 任何 >500 行文件禁止直接继续叠加新逻辑。
- 新增功能优先写在新模块，再回接入口文件。
