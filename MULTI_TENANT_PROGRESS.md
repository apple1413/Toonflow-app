# Toonflow 多租户改造进度

> **最后更新**：2026-05-09（深夜）— **P3 + P4 全部完结**
> **本地分支**：`master`，比 `origin/master` 多 26 个未推 commit（用户暂不推送）
> **目标 DB**：Supabase 项目 `jhzanqsggzhvwjvlnule`，Toonflow 表落在独立 schema `toonflow`

---

## 0. 安全约束（永远生效）

- **绝不**对远程库执行 `DROP / TRUNCATE / DROP SCHEMA / forceInit`
- 任何 `initDB(db, true)` 都需要当次显式授权——`scripts/test-supabase.ts` 默认 `forceInit=false`
- `src/routes/other/deleteAllData.ts` 已经在云模式下 403（仅 Electron 可调）
- `public` schema 那 65 张其他产品的表，整轮改造**全程未动**，每次 commit 后用 `psql ... pg_tables WHERE schemaname='public'` 验过

---

## 1. 已完成（13 个 commit）

| Commit | 范围 | 入口数 |
|---|---|---:|
| `8bd0f30` | SaaS 基础设施：Postgres 双轨 / `searchPath: ["toonflow","public"]` / SSO / `ownership.ts` 工具 / initDB 安全增量迁移 | — |
| `2b4db7d` | **P0** bigint 类型 + `addProject` / `getUser` / `updateUserPwd` 收口 | 4 |
| `3cb892c` | **P1** 项目级 7 个入口 | 7 |
| `10e990b` | P2-1 `assetsGenerate` | 5 |
| `e28e7f5` | P2-2 `task` | 3 |
| `3e2937d` | P2-3 `script` | 8 |
| `cadcebc` | P2-4 `novel` + `novel/event` | 12 |
| `b1752dd` | P2-5 `assets` | 15 |
| `3614c65` | P2-6 `production/storyboard` | 10 |
| `95b05b4` | P2-7 `production/workbench` | 12 |
| `bbbb15c` | P2-8 `production/editImage` + `production/assets` + production root | 13 |
| `9e49f1f` | P2-9 `scriptAgent` / `agents` / `cornerScape` + **关停 `deleteAllData` 云端入口** | 9 |
| `c182eb3` | 类型同步：`memories` / `o_agentWorkData` / `o_skillList` 加 `userId` 字段 | — |
| `b4ed866` | **P3-c** `getBigImage` 按 URL 中的 `projectId` 校验归属 | 1 |
| `ba9346a` | **P3-f / P3-g** imageFlow 直归属（加 userId 列+迁移）+ `initDB` 安全护栏（PG 拒 forceInit）+ columnPatch userId 改 bigInteger | 1 + 4 表 |
| `2445ea3` | **PG 兼容**：跨驱动统一取自增 id，新增 `insertReturnId` helper，扫掉 22 处 `[id] = await knex.insert(...)` 隐患 | 22 处 |
| `8ccc23e` | **P3-d** `vendorConfig/*` (10) + `dbConfig/*` (5) 全锁 admin（堵 API key 泄露 + 防破坏性接口被普通用户调用）；ownership.ts 加 `isAdmin / assertAdmin` | 15 |
| `1a54f7e` | **P3-b** socket.io 长连接加 userId 提取 + projectId/scriptId/isolationKey 归属校验；新增 `src/socket/auth.ts` 公共校验工具 | 2 个 namespace |
| `df64443` | **P3-a** setting/* 改 per-user fall-through（agentDeploy/promptManage/modelMap/memoryConfig/dev 共 13 接口）；新增 `src/utils/perUserSetting.ts`（`fallthroughList` + `upsertForUser`）；4 张表加 userId 列；`o_setting` 约束改成 `(userId, key)` 复合唯一 + NULL 全局兜底 partial unique | 13 |
| `a08f6e3` | **P3-a 收尾** skillManagement 改 per-user（文件系统层）：系统技能仅 admin 可改；私有技能放 `data/skills/users/<userId>/` 仅本人/admin 读写；新增 `src/utils/skillsPath.ts` | 3 |
| `241ba07` | **P4 加固** JWT secret 改环境变量优先（`TOONFLOW_TOKEN_KEY`）；新增 `src/utils/tokenKey.ts`（带缓存 + 失效）；4 处 callsite 改用 helper；env 设值后老 DB-签 token 全部失效（一键轮换） | 4 callsite |
| `a3d008d` | **P4 加固** `o_user.password` 改 bcrypt（cost=10）；新增 `src/utils/password.ts`；老明文兼容比对 + 登录成功时静默升级；`updateUserPwd` 写库前哈希；admin 默认密码 admin123 已迁到 bcrypt 存储但仍能用 admin/admin123 登录 | 2 |
| `bc05ed1` | **P4 加固** `o_user.role` + `disabled` 列（admin 不再硬编码 id=1）；`isAdminAsync/assertAdminAsync` 查 role 列；登录链路加 disabled 拦截 | 2 表/4 处 |
| `8912d38` | **P4 加固** admin 用户管理接口：`/api/admin/user/{list,invite,disable,setRole}`；invite 生成临时随机密码 + 自动 bcrypt；自停用/降级最后 admin 等边界全拦 | 4 |
| `959d285` | **P4 加固** SSO 加 HMAC 签名校验（env `SSO_SHARED_SECRET`）；ts+sig 5 分钟时间窗 timing-safe 比对；env 未设则走旧逻辑 + warn（向后兼容） | 1 |
| `6a0553c` | **P4 加固** per-user vendor inputValues：`o_vendorConfig` 加 userId 列、PK 改复合（userId, id）+ NULL 全局 partial unique；`getVendorList`/`updateVendorInputs`/`agentSetKey` 改 fall-through 解锁给非 admin；其他 vendor type 管理接口仍 admin only；pm2.json 改 env 驱动 | 4 |

**累计 ~140 个 route + socket 入口接入归属/admin/per-user 校验；P3 业务隔离 + P4 auth/admin/部署加固全部到位**。

### 关键设计决策

1. **schema 隔离**：用 `searchPath: ["toonflow", "public"]` 把 Toonflow 表跟其他产品共用库的 65 张表分开。代码里 `db("o_user")` 自动解析到 `toonflow.o_user`，业务代码零改动。
2. **bigint type parser**：`pg.types.setTypeParser(20, parseInt)`——Date.now() 量级 id 远小于 `2^53`，安全。让 JWT/ownership 校验在 PG 下行为与 SQLite 一致。
3. **`src/utils/ownership.ts`** 是收口工具：
   - `userIdOf(req)`：JWT 取 user id，接受 string|number
   - `assertOwnsProject` / `assertOwnsScript` / `assertOwnsAsset` / `assertOwnsStoryboard` / `assertOwnsNovel` / `assertOwnsVideo` / `assertOwnsVideoTrack` / `assertOwnsTask` / `assertOwnsImage` 各种单/批量
   - `assertOwnsEvents`：沿 `o_eventChapter → o_novel → o_project` 链查
   - `assertOwnsImageFlow`：沿 `o_storyboard.flowId / o_assets.flowId` 反查
   - `listOwnedProjectIds`：列表查询用
4. **错误处理**：`ForbiddenError` 类带 `status = 403`，Express 5 自动捕获 async 错误传给 `app.ts:141` 的全局 error handler。

### 实测结论（在 Supabase `toonflow` schema 上）

| 验证 | 结果 |
|---|---|
| A 列出项目只看自己 | ✅ |
| B 查 A 的 script / novel / asset / storyboard / project | ✅ 全部 403 |
| B 调 `updateUserPwd {"id":1}` 试图改 admin 密码 | ✅ admin 行未变，只改自己 |
| 任意用户调 `/api/other/deleteAllData` | ✅ 云模式 403 |
| A 查自己 task / 资产列表 | ✅ 200 |
| `public` schema 65 张表 | ✅ 整轮未动 |

---

## 2. 测试现场

### Supabase 连接（用户每次会话告诉我密码，**不写进 git**）

```
postgresql://postgres.jhzanqsggzhvwjvlnule:<密码>@aws-1-us-west-2.pooler.supabase.com:5432/postgres
```

### 已存在的测试用户（在 `toonflow.o_user`）

| externalId (UUID) | 本地 id | name | 备注 |
|---|---|---|---|
| `16f2dd4d-ccdd-4302-b0e8-bc1e18c9de4c` | `1778224414885` | `hijacked-admin` | P0 越权改密测试**副作用**——名字/密码被改成 `hijacked-admin / hacked`。可以保留作为测试痕迹，或手工改回。 |
| `97bd33ef-7702-4144-8cd9-f76235a6982f` | `1778225441241` | `user_97bd33ef` | 干净的测试用户 |
| (admin 内置) | `1` | `admin` / `admin123` | initData 默认行 |

### 已有项目

| id | name | userId |
|---|---|---|
| `1778225424648` | `P0烟测项目` | `1778224414885` |
| `1778225442599` | `用户B的项目` | `1778225441241` |

### 烟测脚本（启动 dev server）

```bash
DATABASE_URL='postgresql://postgres.jhzanqsggzhvwjvlnule:<密码>@aws-1-us-west-2.pooler.supabase.com:5432/postgres' \
  NODE_ENV=dev yarn dev
```

```bash
TOKEN_A=$(curl -s "http://localhost:10588/api/login/sso?uid=16f2dd4d-ccdd-4302-b0e8-bc1e18c9de4c" | grep -oE 'Bearer [A-Za-z0-9._-]+')
TOKEN_B=$(curl -s "http://localhost:10588/api/login/sso?uid=97bd33ef-7702-4144-8cd9-f76235a6982f" | grep -oE 'Bearer [A-Za-z0-9._-]+')

# A 看自己项目
curl -s -X POST -H "Authorization: $TOKEN_A" http://localhost:10588/api/project/getProject

# B 试图碰 A 的项目应 403
curl -s -X POST -H "Authorization: $TOKEN_B" -H "Content-Type: application/json" \
  -d '{"id":1778225424648}' http://localhost:10588/api/general/getSingleProject
```

### 端口管理（dev server 容易残留）

```bash
lsof -ti:10588 | xargs -r kill -9
pkill -9 -f "tsx.*src/app.ts"
pkill -9 -f "nodemon.*src/app.ts"
```

---

## 3. 待办（P3 全部完结，未来可选项目）

### ~~🔴 a. `/api/setting/*` 配置类大批接口~~ ✅ **完成**（产品决策：per-user fall-through；vendor/dbConfig 留 admin only）

完成（commits `8ccc23e` + `df64443`）：
- `vendorConfig/*` 10 个 + `dbConfig/*` 5 个 → admin only（API key + 破坏性接口）
- `agentDeploy/*` 3 个 + `promptManage/*` 2 个 + `modelMap/*` 2 个 + `memoryConfig/*` 3 个 + `dev/*` 2 个 → per-user fall-through
- `o_agentDeploy / o_prompt / o_modelPrompt / o_setting` 加 `userId` 列；admin seed 回填到 admin 行做"默认值"
- `o_setting` 约束改成 `(userId, key)` 复合唯一 + `WHERE userId IS NULL` partial unique（PG 已 ALTER）
- `agentSetKey` 锁 admin（写全局 vendor 的 API key，不属 per-user）
- `delAllMemory` 改成只删当前用户的（之前是无差别 del() 全部用户）
- 工具：`src/utils/perUserSetting.ts` 暴露 `fallthroughList` 和 `upsertForUser`

**全部完成**（最新 commit `a08f6e3`）：
- `skillManagement/*` 3 个接口已 per-user：系统技能仅 admin 可改；私有技能放 `data/skills/users/<userId>/`，仅本人/admin 读写
- `src/utils/skillsPath.ts` 提供 `classifySkillPath` + `userSkillsDir` 工具
- 端到端验证通过：路径穿越被拦、跨用户读写被拦、系统技能保护、admin 可见全部

### ~~🟠 b. socket.io 长连接归属校验~~ ✅ 已完成（commit `1a54f7e`）

新增 `src/socket/auth.ts`：`verifySocketToken` 取 userId、`authSocketAgentContext` 一站式校验 token+projectId+scriptId+isolationKey。两个 namespace（productionAgent / scriptAgent）替换原本的 verifyToken-only 实现。`updateContext` 事件也重做归属校验。

### ~~🟡 c. `/api/common/getBigImage` URL 签名~~ ✅ 已完成（commit `b4ed866`）

### ~~🟡 d. 响应字段敏感信息审计~~ ✅ 部分完成（commit `8ccc23e`）

- `getUser` 的 password 已移除（P0）
- `o_setting.tokenKey`（JWT secret）：grep 确认从未被任何接口回显（login/sso 内部用，不返回前端）
- `o_vendorConfig.inputValues`（API keys）：通过 admin 锁住整组 vendor 接口堵掉
- `o_user.password`：grep 确认无其他回显路径
- 剩余 `select("*")` 都是项目数据，已被 P0/P1/P2 ownership 限定到当前用户范围

### ~~🟡 e. `/api/login/login` 明文密码登录~~ ✅ 决策：保留作为 admin 后门

用户 2026-05-09 决定保留 form-login。SSO 走普通用户登录流程；form-login 留作 admin 应急入口。
当前已默认就是这个状态（`src/app.ts:119` 白名单），不需要代码改动。

### ~~🟢 f. `saveImageFlow` 标 userId~~ ✅ 已完成（commit `ba9346a`）

`o_imageFlow` 加了 `userId` 列（builder + columnPatch + index + backfill 全套），saveImageFlow 写入当前 userId，`assertOwnsImageFlow` 优先用直接 userId 判定，老行回退到 storyboard/asset 反查。

### ~~🟢 g. `forceInit` 安全护栏~~ ✅ 已完成（commit `ba9346a`）

不直接删 `forceInit` 参数（Electron 本地 SQLite 还需要用来"重置我的数据"），但在 `initDB` 入口加护栏：`isPg && forceInit` 直接抛错。即使有人误传 `forceInit=true` 到生产 PG 也炸不了。

---

## 4. 下次会话如何启动

1. **读这个文件**和 `memory/MEMORY.md`
2. 确认 Supabase 仍是 `jhzanqsggzhvwjvlnule`、用户给密码后用**只读** SQL 校验：
   ```sql
   SELECT count(*) FROM pg_tables WHERE schemaname='public';   -- 应该仍是 65
   SELECT count(*) FROM pg_tables WHERE schemaname='toonflow'; -- 应该 27
   ```
3. 问用户当前要做 P3 哪一项
4. 如果是 P3-a（设置类），先要产品决策再动手

---

## 5. 已知坑/技术备注

- **`buildRoute()` 自动重写 `src/router.ts`**：dev 启动时会基于 `src/routes/` 扫描重新生成 `router.ts`（hash 在第一行）。新增 route 文件后会反映为 `router.ts` 的 diff，是预期行为。
- **`embedding.initEmbedding()` 加了并发锁**：seed 阶段 `Promise.all` 会同时进入，没锁会打满 Supabase pooler 15 连接上限。
- **PG bigint 默认返回 string**：靠 `pg.types.setTypeParser(20, parseInt)` 解决。**所有未来新加的 PG 项目都会踩**。
- **PG INSERT 默认不返回 lastInsertId**：必须 `.returning("id")`。已封装在 `src/utils/insertReturnId.ts`，新写代码请用 `insertReturnId("X", row)`，**不要再用** `const [id] = await u.db("X").insert(...)`。
- **`o_imageFlow` 已加 `userId` 列**：saveImageFlow 写入创建者，`assertOwnsImageFlow` 优先直接判定。Date.now() 量级 id 必须用 `bigInteger`（`integer/int4` 上限 2.1e9 会溢出 22003 错）。
- **`scripts/test-supabase.ts` 已配置 `searchPath: ["toonflow","public"]`** 并把末尾输出从 `public` 改成查 `toonflow.*` 表清单。
- **类型文件 `src/types/database.d.ts` 在 PG 模式下不会自动重建**：`initKnexType()` 只在 `NODE_ENV=dev && !useCloudDb` 跑。给 PG-only 加的字段（如 userId）需要手工同步。
- **columnPatches 必须用 `t.bigInteger`**：之前误用 `t.integer` 在 PG 会建成 4 字节 int4，`Date.now()` 量级 id 写入会溢出。已修，但**新加 columnPatch 时记得仍是 bigInteger**。

---

## 6. 文件索引

- `src/utils/ownership.ts` — 全部归属校验工具（assertOwns* / userIdOf / isAdmin / assertAdmin / isAdminAsync / assertAdminAsync）
- `src/routes/admin/user/*` — admin 用户管理（list / invite / disable / setRole）
- `pm2.json` — 部署配置（用 // 注释行文档化 OSSURL / DATABASE_URL / TOONFLOW_TOKEN_KEY / SSO_SHARED_SECRET 四个 env）
- `src/utils/insertReturnId.ts` — 跨驱动取自增 id 工具（取代裸的 `[id] = await knex.insert()`）
- `src/utils/perUserSetting.ts` — per-user fall-through 工具（`fallthroughList` + `upsertForUser`）
- `src/utils/skillsPath.ts` — 技能文件路径归属判定（系统级 vs `users/<id>/` 私有）
- `src/utils/tokenKey.ts` — JWT secret 来源（env 优先 + DB fallback + 缓存）
- `src/utils/password.ts` — bcrypt 哈希 + 老明文兼容
- `src/utils/db.ts` — 双轨连接配置（含 PG bigint type parser）
- `src/lib/initDB.ts` — 安全增量迁移逻辑（含 schema 创建 + forceInit 护栏）
- `src/routes/login/sso.ts` — SSO 入口
- `src/socket/auth.ts` — socket 连接握手时的 token + projectId/scriptId 归属校验工具
- `src/app.ts` — 启动 + JWT 中间件 + 白名单
- `scripts/test-supabase.ts` — schema 部署脚本（仅做 CREATE/ALTER ADD/CREATE INDEX，安全）
- `data/db2.sqlite.backup-*` — Electron 本地 SQLite 备份（不入 git）
- `MULTI_TENANT_PROGRESS.md` — 本文件
