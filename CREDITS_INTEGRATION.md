# Toonflow ↔ 主项目（dig_credits）积分扣费对接 spec

> Toonflow 不直接写 `public.dig_credits` 表，而是调主项目暴露的两个内部 HTTP API。
> 主项目内部用既有的 dig_credits ledger 逻辑扣减 + 写流水（带过期、幂等、deleted_at 等业务规则）。

## 主项目需要暴露的两个接口

### 1. `POST /api/internal/credits/charge` ——扣费

**请求**：
```http
POST /api/internal/credits/charge
Authorization: Bearer <CREDITS_API_TOKEN>
Content-Type: application/json

{
  "user_uuid": "97bd33ef-7702-4144-8cd9-f76235a6982f",
  "amount": 50,
  "scene": "toonflow:image_generation",
  "task_id": "toonflow:storyboard-batch:42:101,102,103"
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `user_uuid` | string (UUID) | 用户在主项目侧的 UUID（= `dig_users.uuid` / `voice_users.uuid`），Toonflow 通过 `o_user.externalId` 查到 |
| `amount` | number > 0 | 本次要扣的积分数量。由 Toonflow 端的 `o_setting.cost.<scene>` 配置决定 |
| `scene` | string | 业务场景标识，建议格式 `toonflow:<op>`。用于主项目流水统计、限额、审计 |
| `task_id` | string | 幂等键。同一 task_id 重复扣费请求应返回 409 + 当前余额 |

**响应**：

| HTTP | body | 含义 |
|---|---|---|
| 200 | `{ "ok": true, "remaining": 1234567 }` | 扣费成功，返回剩余余额 |
| 402 | `{ "error": "余额不足", "remaining": 12 }` | 余额不够；`remaining` 是实际剩余 |
| 409 | `{ "ok": true, "remaining": 1234567, "duplicate": true }` | task_id 已处理过（幂等命中），返回当前余额 |
| 401 | `{ "error": "auth" }` | Bearer token 不对 |
| 400 | `{ "error": "..." }` | 参数错误（user_uuid 不存在、amount 非正等） |
| 5xx | 任意 | 主项目内部错误，Toonflow 会拒绝业务调用并提示重试 |

**主项目内部逻辑建议**：
1. PG 事务内
2. `INSERT INTO public.dig_credits (trans_no, user_uuid, trans_type, credits, order_no, ...)` 写一条新 ledger 行：
   - `trans_no` 用 task_id 或基于 task_id 派生的稳定值（保证唯一）
   - `trans_type = 'consume'` 或更细的 `toonflow_image_gen` 等便于统计
   - `credits = -amount`（负数）
3. 在写之前用 `SELECT SUM(credits) FROM public.dig_credits WHERE user_uuid = ? AND deleted_at IS NULL AND (expired_at IS NULL OR expired_at > NOW())` 算余额，不够就返 402
4. 幂等：用 `dig_credits_trans_no_key` 唯一约束兜底——重复请求 INSERT 撞 unique 时不报错而是返 409 + 当前余额

### 2. `GET /api/internal/credits/balance?user_uuid=<uuid>` ——查询余额（可选）

**请求**：
```http
GET /api/internal/credits/balance?user_uuid=97bd33ef-...
Authorization: Bearer <CREDITS_API_TOKEN>
```

**响应**：
```json
{ "remaining": 1234567 }
```

Toonflow 前端用此接口在用户中心展示当前积分。**仅 SELECT，不扣费**。

## Toonflow 这边的环境变量

```bash
CREDITS_API_URL=https://main.example.com/api/internal/credits/charge
CREDITS_BALANCE_URL=https://main.example.com/api/internal/credits/balance   # 可选，不设默认 charge URL 末尾换 /balance
CREDITS_API_TOKEN=<内部固定 token，越长越好>
```

env 没设 → Toonflow 跳过扣费 + warn 一次（dev / Electron 单机版友好）。

## 价格配置（Toonflow 这边）

每个 `scene` 扣多少积分由 Toonflow 的 admin 自己控制——存在 `toonflow.o_setting` 表里 `key='cost.<scene>'` 的全局行（`userId IS NULL`）。

**当前 Toonflow 已接入扣费的场景**：

| Scene key | 默认价格 | 触发路由 |
|---|---:|---|
| `image_generation` | 50 | `/api/production/storyboard/batchGenerateImage`（每次批量调用扣 1 次） |
| `video_generation` | 500 | `/api/production/workbench/generateVideo`（每次扣 1 次） |

> 还没接入的（未来批量补）：单次 generateAssets / batchGenerateImageAssets / batchGenerateAssetsImage / 视频提示词生成 / 文本类 universalAi 调用 / 资产提取 / 事件生成。
> 接入方式：在 route handler 入口加 `await chargeCredits({ userExternalId, scene, taskId })`，捕获 `InsufficientCreditsError` 返 402。

**改价格**（admin 操作，无需重启）：
```http
POST /api/admin/credits/setCost   # admin only
{
  "scene": "image_generation",
  "amount": 80
}
```

```http
POST /api/admin/credits/getCosts  # admin only，列出当前所有场景价格 + 是否 admin 覆盖过
```

## 对接验收 checklist

- [ ] 主项目实现 `POST /api/internal/credits/charge`，按上述协议返回 200/402/409
- [ ] 主项目实现 `GET /api/internal/credits/balance`（可选但推荐，前端展示用）
- [ ] 配置 Toonflow 的 `CREDITS_API_URL` / `CREDITS_API_TOKEN` 两个 env
- [ ] 烟测：拿一个余额够的用户从 Toonflow 调 generateVideo → 主项目 dig_credits 表新增 -500 流水
- [ ] 烟测：把用户余额清掉 → 调 generateVideo 应返 402 + 错误信息
- [ ] 烟测：同一 task_id 重复调 → 主项目应返 409，Toonflow 视为成功（不重复扣）
- [ ] 跑 P3+P4 的多租户 E2E（admin/user/SSO/role/ban）验证扣费跟 user 隔离正确
