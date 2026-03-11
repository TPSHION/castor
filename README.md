# Castor Desktop (Tauri + Rust + React)

Castor 是一个桌面化的远程运维工具，基于 React + TypeScript（前端）和 Tauri + Rust（后端）构建。

## 当前能力（v1.2.0）

### 终端与连接
- SSH 终端会话（密码 / 私钥）
- 本地终端会话
- 多 Tab 工作区（连接状态、失败重试、断开）
- 服务器配置管理（新增 / 编辑 / 删除 / 测试）

### 文件传输与文件管理
- 本地 / 远程双栏文件浏览（Local + SFTP）
- 上传 / 下载（进度、ETA、速度、取消）
- 上传冲突策略（自动重命名 / 覆盖 / 手动重命名）
- 拖拽传输（栏内拖拽 + 系统文件拖放上传）
- 本地文件操作（重命名 / 删除 / 新建目录）
- 远程文件操作（重命名 / 删除 / 新建目录 / 权限修改）
- 任务面板（进行中 / 已完成 / 清理已完成）

### 服务管理
- systemd 部署管理（列表、表单、部署、控制、日志、导入）
- nginx 服务管理（新增/导入、状态、启停重载重启、配置检测）

### 运行环境管理
- 远程运行时探测（Node / Java / Go / Python）
- 运行时部署（版本列表、计划预览、实时日志、取消）

## 架构与目录

### 前端
- `src/App.tsx`：应用总编排与视图切换
- `src/components/*`：页面与模块化 UI
- `src/components/sftp/*`：SFTP 视图子模块（拖拽、进度渲染、类型）
- `src/app/api/*`：Tauri invoke 调用封装
- `src/app/hooks/*`：状态与副作用逻辑
- `src/types.ts`：前后端契约类型

### 后端
- `src-tauri/src/ssh/mod.rs`：SSH / 本地 PTY 会话
- `src-tauri/src/sftp.rs`：SFTP 文件传输与进度事件
- `src-tauri/src/localfs.rs`：本地文件系统操作
- `src-tauri/src/deploy.rs`：systemd 部署与日志
- `src-tauri/src/nginx.rs`：nginx 管理
- `src-tauri/src/runtime.rs`：运行环境探测
- `src-tauri/src/runtime_deploy.rs`：运行环境部署
- `src-tauri/src/commands.rs`：Tauri 命令桥接
- `src-tauri/src/main.rs`：命令注册入口

## 开发

1. 安装依赖

```bash
pnpm install
```

2. 安装 Rust 工具链（若未安装）

```bash
curl https://sh.rustup.rs -sSf | sh
```

3. 启动开发模式（前端 + Tauri）

```bash
pnpm tauri dev
```

## 构建与检查

- 前端构建（含 TS 检查）

```bash
pnpm run build
```

- Rust 编译检查

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

## 功能开发落地路径（强制）

新增一个完整功能时，按以下顺序推进：

1. `types`：先定义/补齐前后端契约类型
2. `rust module`：实现后端业务逻辑
3. `commands/main 注册`：桥接命令并注册
4. `前端 api`：封装 invoke 接口
5. `hook`：承载状态、副作用与流程编排
6. `panel/ui`：页面/面板渲染与交互

详细说明见 [docs/feature-delivery-workflow.md](docs/feature-delivery-workflow.md)。

## 文档索引

- 实现归纳：`docs/v1.2.0-implementation-summary.md`
- 模块速查：`docs/developer-module-quick-reference.md`
- 编码规范：`docs/coding-standards.md`
- 功能开发工作流：`docs/feature-delivery-workflow.md`
- 大文件优化计划：`docs/large-file-optimization-plan.md`

## 注意事项

- 连接配置保存在应用配置目录下的 `connection_profiles.json`。
- 当前敏感信息（密码 / 私钥 / passphrase）仍为明文持久化，仅适合本地受控环境。
