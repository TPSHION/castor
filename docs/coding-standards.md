# Castor 编码规范

## 1. 模块拆分（强制）

- 不允许把一个完整功能域全部堆在单个文件中。
- 页面入口（`*View.tsx`）保持“入口薄、实现厚”，仅做切换与组装。
- 业务流程、异步副作用、事件监听必须进入 `src/app/hooks/`。
- API 调用统一收敛到 `src/app/api/`，UI 组件禁止直接拼接 invoke 命令。

## 2. 功能开发标准路径（强制）

新增功能必须按以下顺序推进：

1. `types`
2. `rust module`
3. `commands/main 注册`
4. `前端 api`
5. `hook`
6. `panel/ui`

详细说明见：`docs/feature-delivery-workflow.md`

## 3. 文件体量治理

- TS/TSX 文件建议 ≤ 300 行。
- 超过 500 行必须拆分（至少拆出 types / helper / hook / partial 之一）。
- 超过 800 行视为高优先级治理对象，禁止继续叠加新逻辑。
- 样式文件若长期增长，按领域拆分（如 `styles/sftp.css`、`styles/systemd.css`）。

## 4. 目录约定

- hooks：`src/app/hooks/useXxx.ts(x)` 或 `src/app/hooks/<domain>/useXxx.ts(x)`
- API：`src/app/api/<domain>.ts`
- 可复用 UI：`src/components/<domain>/`
- 领域类型：优先按领域拆分到 `src/components/<domain>/types.ts` 或 `src/app/types.ts`

## 5. 变更要求

- 新增复杂功能时，优先新建模块，而不是继续扩展巨型文件。
- 重构优先保证行为不变；结构优化与功能迭代尽量分步提交。
- 提交前必须至少执行：
  - `pnpm run build`
  - 若改 Rust：`cargo check --manifest-path src-tauri/Cargo.toml`
