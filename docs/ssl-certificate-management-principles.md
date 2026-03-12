# SSL 证书管理实现原理（Let’s Encrypt）

## 1. 目标与范围

本模块用于在 Castor 中提供统一的 SSL 证书管理能力，重点覆盖：

- 证书申请（Let’s Encrypt / ACME）
- 证书部署（落盘到目标路径并通知服务重载）
- 自动续期（到期前检查、续签、验证、重载）
- 证书资产视图（域名、状态、到期时间、最近更新）

不在本模块范围内的内容：

- CA 本身实现（依赖 Let’s Encrypt）
- DNS 提供商内部 SDK 的完整封装（只适配必要 API）
- 业务应用 TLS 配置细节（Nginx/Apache/自定义服务由适配层处理）

---

## 2. 可用性前提

证书能“真正可用”依赖以下前置条件：

1. 有可用域名（不能只用裸 IP）
2. 域名解析正确指向目标服务（或可控制 DNS）
3. 验证方式可达：
   - HTTP-01：公网可访问 80
   - DNS-01：可写 DNS TXT 记录
4. 服务器时间准确（NTP 正常）
5. 目标服务支持热重载/重启并可读取证书文件

---

## 3. 架构分层

按项目现有开发工作流拆分：

1. `UI/Panel`：参数录入、状态展示、手动操作入口  
   参考：`src/components/environment/EnvironmentSslPanel.tsx`
2. `Hook`：状态机、异步流程编排、消息提示
3. `API`：前端到 Tauri 命令的调用封装（不承载业务）
4. `Rust Domain`：ACME 执行、文件写入、续期调度、错误归一化
5. `Remote Runtime`：远端执行 `acme.sh`/`certbot`、写证书、重载服务

---

## 4. 核心模型

建议的证书记录模型（逻辑层）：

- `id`: 证书记录唯一标识
- `profile_id`: 目标服务器 ID
- `domain`: 主域名
- `sans`: 扩展域名列表
- `challenge_type`: `http` | `dns`
- `issuer`: 如 `Let's Encrypt`
- `status`: `pending` | `active` | `expiring` | `failed`
- `not_before` / `not_after`: 证书有效期
- `auto_renew_enabled`: 是否自动续期
- `renew_before_days`: 到期前多少天触发
- `deploy_target`: 证书部署路径与 reload 命令
- `last_error`: 最近一次失败信息（可空）
- `updated_at`: 最近更新时间

状态定义原则：

- `pending`：申请/续期进行中
- `active`：校验通过且在有效期内
- `expiring`：剩余天数 <= `renew_before_days`
- `failed`：最近一次操作失败，需要人工介入

---

## 5. 申请流程原理

1. 用户在 UI 填写域名、邮箱、挑战方式、部署参数
2. 本地先做参数校验（域名格式、邮箱、路径、命令）
3. Rust 层执行前置探测：
   - HTTP-01 是否具备 80 端口可达条件
   - DNS-01 是否存在可用 DNS API 凭证
4. 触发 ACME 申请（优先使用标准客户端）
5. 成功后解析证书元信息（签发方、到期时间、指纹）
6. 写入目标证书路径，执行服务重载命令
7. 写入/更新证书记录，状态置为 `active`

关键原则：

- 私钥优先在目标服务器生成并保存
- 证书链使用 `fullchain` 部署
- 重载失败时证书仍可保留，但状态应标记为 `failed` 并提示恢复动作

---

## 6. 自动续期原理

续期任务建议每天执行一次：

1. 扫描所有 `auto_renew_enabled = true` 的证书记录
2. 计算剩余天数
3. 对 `remaining_days <= renew_before_days` 的记录执行续期
4. 续期成功后：
   - 更新 `not_after`
   - 执行 reload
   - 更新状态为 `active`
5. 续期失败后：
   - 保留原证书（不破坏当前可用性）
   - 记录错误与失败时间
   - 状态更新为 `failed`

设计重点：

- 续期任务必须幂等（同一证书重复触发不应破坏状态）
- 单证书失败不应阻塞其它证书续期
- 所有执行日志要可审计（便于定位 DNS/端口/权限问题）

---

## 7. 部署与回滚策略

证书部署建议采用“原子替换”：

1. 先写临时文件（如 `.tmp`）
2. 校验文件完整性与权限
3. 原子重命名覆盖目标文件
4. 执行服务 reload

回滚策略：

- 若 reload 失败，保留上一版本证书路径引用（或回滚软链接）
- 记录失败事件并提示人工确认服务状态

---

## 8. 安全设计要点

1. 私钥不回传到前端，仅在远端安全落盘
2. DNS API Token 使用最小权限（仅特定 zone 的 TXT）
3. 日志脱敏（不输出完整 token/private key）
4. 证书文件权限最小化（如 `600` + 专用用户组）
5. 所有远程命令参数做严格转义，避免命令注入

---

## 9. 当前代码状态与演进路线

当前状态（已完成）：

- 菜单入口已增加：`环境部署 -> SSL证书管理`
- 页面骨架已具备：申请参数、续期策略、证书列表（前端占位）

参考文件：

- `src/components/ServersView.tsx`
- `src/components/environment/EnvironmentSslPanel.tsx`
- `src/styles/app/environment/ssl.css`

下一步建议（按工作流执行）：

1. `types`：补充证书管理请求/响应类型（`src/types.ts`）
2. `rust module`：新增 `ssl.rs` 领域模块（申请/续期/部署）
3. `commands/main`：注册 Tauri 命令桥接
4. `api`：新增 `src/app/api/ssl.ts`
5. `hook`：新增 `useSslCertificates` 状态机
6. `panel`：将占位逻辑替换为真实数据与动作

---

## 10. 失败场景速查

- 域名校验失败：通常是 DNS 未生效或端口不可达
- HTTP-01 失败：80 端口被占用、防火墙未放行、反向代理规则拦截
- DNS-01 失败：API 凭证权限不足、记录未传播、zone 配置错误
- 续期成功但站点异常：证书路径未同步到服务配置或 reload 未生效

排查顺序建议：

1. 先看 ACME 原始错误
2. 再看网络与 DNS
3. 最后看部署路径与服务 reload

