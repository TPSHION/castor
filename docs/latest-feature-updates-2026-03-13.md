# 最新功能改动总结（2026-03-13）

本文档用于记录近期已落地且影响用户操作路径的功能增量，重点覆盖：

- SSL 证书管理能力完善
- 远程代理管理从 sing-box 迁移到 Mihomo
- 代理页面信息架构重构与状态可观测性增强

---

## 1. 远程代理管理：统一改为 Mihomo

### 1.1 入口与页面结构

- 菜单入口保持为：`远程代理管理`
- 该入口当前直接进入 Mihomo 管理页面，不再展示独立的 sing-box 页面
- 页面拆分为两个子页：
  - `订阅节点`：仅管理订阅和查看节点，不做部署动作
  - `代理配置`：集中放置部署、状态查询、实时日志、取消部署

主要文件：
- `src/components/ServersView.tsx`
- `src/components/environment/EnvironmentMihomoPanel.tsx`

### 1.2 部署能力

新增并稳定了 Mihomo 部署链路：

- 支持部署模式：
  - `application`（应用层代理版）
  - `tun_global`（tun 全局版）
- 支持部署中实时日志输出
- 支持取消部署
- 支持部署后自动验通和关键诊断输出

主要文件：
- `src-tauri/src/proxy.rs`
- `src/app/hooks/environment/useEnvironmentMihomo.ts`

### 1.3 远程状态查询增强

远程状态查询现可展示：

- 服务状态：是否安装、是否运行、是否自启
- 配置状态：配置文件是否存在
- 部署模式：`应用层代理版 / tun 全局版`
- Mihomo 运行模式（如 `rule`）
- 当前实际代理信息：
  - 节点名称
  - 协议类型
  - 服务器与端口
  - 加密方式
- 本地订阅匹配结果：按 `server:port`（并尽量结合协议/加密）回查本地节点

主要文件：
- `src-tauri/src/proxy.rs`
- `src/components/environment/EnvironmentMihomoPanel.tsx`
- `src/types.ts`

### 1.4 本地安装包优先策略

Mihomo 安装支持“本地包优先，联网下载兜底”：

- 优先从以下目录查找本地安装包并上传远程安装：
  - `src-tauri/resources/proxy-packages`
- 典型文件名示例：
  - `mihomo-linux-amd64-*.gz`
  - `mihomo-linux-arm64-*.gz`

主要文件：
- `src-tauri/src/proxy.rs`

### 1.5 新增命令与事件

新增后端命令：

- `apply_mihomo_proxy_node`
- `get_mihomo_runtime_status`

新增前端实时事件：

- `mihomo-apply-log`

桥接文件：
- `src-tauri/src/commands.rs`
- `src-tauri/src/main.rs`
- `src/app/api/proxy.ts`

---

## 2. SSL 证书管理：流程可观测与可恢复性增强

### 2.1 页面与操作结构

SSL 管理已从占位形态升级为可执行流程：

- 列表页 + 新增/编辑独立页
- 新增/编辑页仅保留核心表单操作：`保存` / `重置`
- 列表页支持：
  - 申请并部署
  - 续期并部署
  - 状态同步
  - 下载证书链 / 私钥
  - 删除（带确认）

主要文件：
- `src/components/environment/EnvironmentSslPanel.tsx`
- `src/app/hooks/environment/useSslCertificates.ts`
- `src/app/api/ssl.ts`
- `src-tauri/src/ssl.rs`

### 2.2 交互与可用性细节

- 表单项区分必填/非必填
- 输入框禁用自动完成与大小写纠错（避免证书参数被浏览器改写）
- 根据域名自动生成证书路径示例
- 申请流程增加“简洁步骤说明 + 前置要求说明”
- 失败步骤提供处理建议与“重试当前操作”
- 下载证书前先选择本地目录

---

## 3. 类型与契约增量

本次增量同步更新了前后端契约，重点包含：

- Mihomo 部署请求/响应类型
- Mihomo 运行状态类型（含部署模式、当前代理明细）
- 前端 API 封装新增 Mihomo 调用方法

主要文件：
- `src/types.ts`
- `src/app/api/proxy.ts`

---

## 4. 编译与验证

本轮改动已通过以下检查：

- `cargo check`
- `pnpm -s tsc --noEmit`
- `pnpm -s build`

---

## 5. 当前建议使用路径

1. 进入 `远程代理管理`
2. 在 `订阅节点` 页添加/更新订阅并做连通性测试
3. 进入 `代理配置` 页选择服务器、代理节点、部署模式后应用
4. 在同页查看远程状态与“当前代理节点”是否匹配预期

