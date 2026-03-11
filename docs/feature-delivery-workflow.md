# Castor 功能开发工作流

## 目标

确保新增功能按统一顺序落地，降低前后端契约错位、命令漏注册、UI 与业务耦合过深的问题。

## 标准路径

每个功能按以下顺序实现，不跳步：

1. `types`
2. `rust module`
3. `commands/main 注册`
4. `前端 api`
5. `hook`
6. `panel/ui`

---

## 1. types

文件：`src/types.ts`

要求：
- 先补齐请求/响应/事件 payload 类型。
- 命名与 Rust 结构体语义保持一致（snake_case 字段在请求层保持一致）。
- 先改类型，再写实现，避免“边写边猜结构”。

---

## 2. rust module

文件示例：`src-tauri/src/<domain>.rs`

要求：
- 在领域模块实现核心业务逻辑与参数校验。
- 优先复用现有连接池、持久化和错误格式化模式。
- 只在模块内部处理细节；命令桥层保持 thin wrapper。

---

## 3. commands/main 注册

文件：
- `src-tauri/src/commands.rs`
- `src-tauri/src/main.rs`

要求：
- 在 `commands.rs` 新增 `#[tauri::command]` 桥接函数。
- 在 `main.rs` 的 `generate_handler![]` 中注册命令。
- 命令名与前端 invoke 字符串必须一一对应。

---

## 4. 前端 api

文件：`src/app/api/<domain>.ts`

要求：
- 统一通过 `invokeTauriWithRequest` / `invokeTauri` 调用。
- UI 组件不直接拼接命令字符串。
- API 层只做 I/O 映射，不承载业务状态。

---

## 5. hook

文件：`src/app/hooks/<domain>/useXxx.ts(x)` 或 `src/app/hooks/useXxx.ts(x)`

要求：
- 状态机、副作用、错误处理、异步流程都放 hook。
- 事件监听（`listen(...)`）在 hook 中集中管理与清理。
- 避免在 View/Panel 中写大段流程代码。

---

## 6. panel/ui

文件：`src/components/*`

要求：
- `*View.tsx` 仅负责页面入口和组装。
- Panel / Partial 负责渲染与交互，不直接调用 Rust 命令。
- 复杂视图按领域拆分子组件（例如 `src/components/sftp/*`）。

---

## 交付前自检清单

- 类型：`src/types.ts` 与 Rust struct 一致。
- 命令：`commands.rs` 已桥接，`main.rs` 已注册。
- API：`src/app/api` 已封装，UI 无裸 `invoke(...)`。
- Hook：业务流程在 hook，组件只消费状态与回调。
- 结构：无新增“巨型单文件”。
- 验证：至少执行一次 `pnpm run build`，后端改动执行 `cargo check`。

## 典型改动路径示例

以“新增 nginx 证书检测”功能为例：

1. `src/types.ts` 新增 `TestNginxCertificateRequest/Result`
2. `src-tauri/src/nginx.rs` 实现业务函数
3. `src-tauri/src/commands.rs` 增加 command，`src-tauri/src/main.rs` 注册
4. `src/app/api/profiles.ts` 新增调用封装
5. `src/app/hooks/useNginxServices.tsx` 增加状态与流程
6. `src/components/NginxServicePanel.tsx` 增加按钮与结果展示
