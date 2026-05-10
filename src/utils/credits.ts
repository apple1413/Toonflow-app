import db from "@/utils/db";

/**
 * 跨产品积分扣费客户端。
 *
 * 架构：Toonflow 不直接写主项目的 public.dig_credits 流水表（避免双方代码同时
 * 改一张会计表带来的版本漂移、并发竞态、重构风险）；而是调主项目暴露的内部
 * HTTP API（spec 见仓库根 CREDITS_INTEGRATION.md）。
 *
 * 配置来源：
 *   - 主项目 charge API URL：env `CREDITS_API_URL`（必需）
 *   - 内部鉴权 token：env `CREDITS_API_TOKEN`（必需）
 *   - 每个 scene 的扣费数量：o_setting 全局行 key='cost.<scene>'（admin 可通过
 *     /api/admin/credits/setCost 改），缺省走 DEFAULT_COSTS。
 *
 * 降级：env 没配置时跳过扣费 + console.warn 一次（开发模式 / Electron 单机版友好）。
 */

/** 默认价目表（积分/次）。admin 没有在 o_setting 里覆写时使用 */
export const DEFAULT_COSTS: Record<string, number> = {
  // 图片类
  image_generation: 50, // 单次资产/分镜图生成
  image_polish: 5, // 提示词润色
  image_flow: 50, // 工作流图片生成
  // 视频类
  video_generation: 500, // 单次视频生成
  video_prompt_generation: 10, // 视频提示词生成
  // 文本类
  text_generation: 5, // 通用 universalAi 调用
  asset_extract: 10, // 剧本资产提取
  event_generate: 10, // 小说事件生成
};

const COST_KEY_PREFIX = "cost.";

export async function getCost(scene: string): Promise<number> {
  const key = `${COST_KEY_PREFIX}${scene}`;
  const row = await db("o_setting").where({ key }).whereNull("userId").select("value").first();
  const fromDb = row?.value != null ? Number(row.value) : NaN;
  if (Number.isFinite(fromDb) && fromDb >= 0) return fromDb;
  return DEFAULT_COSTS[scene] ?? 0;
}

/** 列出所有 admin 配置过的 cost.* 全局值，合并默认表回显给 admin UI */
export async function listCosts(): Promise<Array<{ scene: string; amount: number; isOverride: boolean }>> {
  const rows = await db("o_setting").where("key", "like", `${COST_KEY_PREFIX}%`).whereNull("userId").select("key", "value");
  const overrideMap = new Map<string, number>();
  for (const r of rows) {
    if (!r.key) continue;
    const scene = r.key.slice(COST_KEY_PREFIX.length);
    const v = Number(r.value);
    if (Number.isFinite(v) && v >= 0) overrideMap.set(scene, v);
  }
  // 合并默认 + 覆盖
  const allScenes = new Set([...Object.keys(DEFAULT_COSTS), ...overrideMap.keys()]);
  return [...allScenes].sort().map((scene) => ({
    scene,
    amount: overrideMap.has(scene) ? overrideMap.get(scene)! : DEFAULT_COSTS[scene] ?? 0,
    isOverride: overrideMap.has(scene),
  }));
}

export async function setCost(scene: string, amount: number): Promise<void> {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("amount 必须 >= 0");
  const key = `${COST_KEY_PREFIX}${scene}`;
  const existing = await db("o_setting").where({ key }).whereNull("userId").first();
  if (existing) {
    await db("o_setting").where({ key }).whereNull("userId").update({ value: String(amount) });
  } else {
    await db("o_setting").insert({ key, value: String(amount), userId: null as any });
  }
}

export class InsufficientCreditsError extends Error {
  status = 402;
  constructor(public remaining: number, public required: number) {
    super(`积分不足：需要 ${required}，剩余 ${remaining}`);
    this.name = "InsufficientCreditsError";
  }
}

let warnedNoApi = false;

/**
 * 扣费主入口。在付费 route 启动 AI 调用前调用。
 *
 * @param userExternalId  toonflow user.externalId（与主项目 voice_users.uuid / dig user 同 UUID）
 * @param scene           DEFAULT_COSTS 的 key，如 "image_generation"
 * @param taskId          幂等键，建议传 toonflow 这边生成的 imageId/videoId/uuid
 *
 * 返回 charged=0 表示降级跳过；charged>0 + remaining 表示成功扣费。
 * 余额不足抛 InsufficientCreditsError；其他失败抛通用 Error（route 自行决定回退）。
 */
export async function chargeCredits(opts: {
  userExternalId: string;
  scene: string;
  taskId: string;
}): Promise<{ remaining: number; charged: number }> {
  const cost = await getCost(opts.scene);
  if (cost <= 0) return { remaining: -1, charged: 0 };

  const apiUrl = process.env.CREDITS_API_URL;
  const apiToken = process.env.CREDITS_API_TOKEN;
  if (!apiUrl) {
    if (!warnedNoApi) {
      console.warn(
        "[credits] CREDITS_API_URL 未配置——所有扣费请求会被跳过（dev / Electron 模式）。生产环境请设置 env 让 Toonflow 接主项目积分系统。",
      );
      warnedNoApi = true;
    }
    return { remaining: -1, charged: 0 };
  }
  if (!opts.userExternalId) {
    // 老用户没 externalId（比如 admin form-login 的）——跳过扣费
    return { remaining: -1, charged: 0 };
  }

  let resp: Response;
  try {
    resp = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify({
        user_uuid: opts.userExternalId,
        amount: cost,
        scene: opts.scene,
        task_id: opts.taskId,
      }),
    });
  } catch (e: any) {
    throw new Error(`[credits] 调主项目 charge API 网络失败: ${e?.message ?? e}`);
  }

  if (resp.status === 402) {
    const body = await resp.json().catch(() => ({} as any));
    throw new InsufficientCreditsError(Number(body?.remaining ?? 0), cost);
  }
  if (resp.status === 409) {
    // 主项目已记录该 task_id，幂等返回视为成功
    const body = await resp.json().catch(() => ({} as any));
    return { remaining: Number(body?.remaining ?? -1), charged: 0 };
  }
  if (!resp.ok) {
    throw new Error(`[credits] charge API 返回 ${resp.status} ${resp.statusText}`);
  }
  const body = await resp.json().catch(() => ({} as any));
  return { remaining: Number(body?.remaining ?? -1), charged: cost };
}

/**
 * 查询用户余额。仅展示用，不扣费。
 * 返回 -1 表示未配置 API（dev 模式）。
 */
export async function getBalance(userExternalId: string): Promise<number> {
  const apiUrl = process.env.CREDITS_BALANCE_URL ?? process.env.CREDITS_API_URL;
  if (!apiUrl) return -1;
  if (!userExternalId) return -1;
  const apiToken = process.env.CREDITS_API_TOKEN;
  // 主项目可以提供同一个 base 下的 GET /balance?user_uuid=xxx，或独立 URL
  const balanceUrl = process.env.CREDITS_BALANCE_URL ?? apiUrl.replace(/\/charge$/, "/balance");
  try {
    const resp = await fetch(`${balanceUrl}?user_uuid=${encodeURIComponent(userExternalId)}`, {
      method: "GET",
      headers: { ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}) },
    });
    if (!resp.ok) return -1;
    const body = await resp.json().catch(() => ({} as any));
    return Number(body?.remaining ?? -1);
  } catch {
    return -1;
  }
}
