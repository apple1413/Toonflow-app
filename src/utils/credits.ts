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

/* ===========================================================================
 * 按模型计费（vendor + model 维度，覆盖 scene 维度）
 *
 * 现状：DEFAULT_COSTS 按 scene 一刀切扣（如所有 video_generation 一律 500）。
 * 问题：apimart Sora 2 Pro 1080p 16s 实际成本 ~¥23，而 Wan 2.6 5s 720p ~¥0.5，
 *      同样扣 500 积分会出现严重交叉补贴。
 *
 * 解决：对图像/视频改成"按 (vendor, model, config) 估算真实成本 → 加成扣"。
 *      文本继续走 scene，因为单次开销小且 token 数依赖运行时。
 *
 * 加价系数：用户单价 = 79元/3600积分 = ¥0.02194/积分
 *           30% 毛利 → 每¥1上游成本扣 70 积分（含 ~7% 汇率/失败/估价误差缓冲）
 *           USD 换算 → 每$1上游成本扣 504 积分（按 ¥7.2/$）
 *
 * 价目表覆盖：admin 可在 o_setting 行 key='cost.<vendor>.<model>' value=<credits>
 *           写死单价，绕过这里的 USD 估算（适合实测拿到真实价后微调）。
 * =========================================================================== */

const USD_TO_CNY = 7.2;
const CREDITS_PER_CNY = 70; // 30% 毛利 + 缓冲；改这里就能整体调价
const MIN_CREDITS_PER_CALL = 1; // 任何调用最少扣 1 积分，避免"聊到吐都扣 0"
const MODEL_COST_KEY_PREFIX = "cost.";

type PerImageCost = { kind: "perImage"; usd: number };
type PerSecondCost = {
  kind: "perSecond";
  usd: number; // 基准价（720p、无音频）
  resolutionMultiplier?: Record<string, number>; // 默认 {480p:0.5, 720p:1.0, 1080p:1.5, 4k:3.0}
  audioSurcharge?: number; // 启用 audio 时的乘数，默认 1
  fixedDuration?: boolean; // veo3.1 这种固定 8s 的，不按用户传的 duration 算
};
type PerCallCost = { kind: "perCall"; usd: number }; // 一次调用统一价（适合 imagen/极简模型）
// 文本调用平均价（CNY/次）。理由：文本厂商多按 ¥/百万token 计费，但 token 数运行时才知道，
// 直接按"模型平均一次调用成本"扣 + 每月看账单校准平均值，最务实
type PerTextCallCost = { kind: "perTextCall"; cny: number };
type ModelCostEntry = PerImageCost | PerSecondCost | PerCallCost | PerTextCallCost;

const DEFAULT_RESOLUTION_MULTIPLIER: Record<string, number> = {
  "480p": 0.6,
  "720p": 1.0,
  "768p": 1.05,
  "1024p": 1.3,
  "1080p": 1.5,
  "4k": 3.0,
  "4K": 3.0,
};

/**
 * 默认价目表（vendor → model → 成本）。
 *
 * 数据来源：
 *   - apimart：官网公布的图像价 (https://apimart.ai/) + 行业实测视频价（2026/04 数据，
 *     来源 atlascloud.ai/devtk.ai/awesomeagents.ai 等横评，apimart 自身价格按 -20%）
 *   - volcengine：官方文档 (https://www.volcengine.com/docs/82379/1544106) 真实价
 *
 * USD 价 → 积分公式：credits = ceil(usd * USD_TO_CNY * CREDITS_PER_CNY * multipliers)
 * CNY 价 → 积分公式：credits = ceil(cny * CREDITS_PER_CNY * multipliers)
 *
 * TODO：拿到 apimart $10 测试 key 跑实测后修正视频单价；火山 Seedance 等 token 计费的
 *      模型暂用每秒近似（720p 720 token/s 估算），后续若 API 返回 usage 则改为按 usage 结算。
 */
export const MODEL_COSTS: Record<string, ModelCostEntry> = {
  // ============ APIMart 图像（apimart 官网价 USD/张）============
  "apimart.gpt-image-2": { kind: "perImage", usd: 0.006 },
  "apimart.z-image-turbo": { kind: "perImage", usd: 0.01 },
  "apimart.wan2.7-image": { kind: "perImage", usd: 0.022 },
  "apimart.qwen-image": { kind: "perImage", usd: 0.02 },
  "apimart.imagen-4.0": { kind: "perImage", usd: 0.04 },
  "apimart.gemini-2.5-flash-image": { kind: "perImage", usd: 0.025 },
  "apimart.gemini-3-pro-image": { kind: "perImage", usd: 0.04 },
  // Seedream 系列在 apimart 没公开单价，按火山官方价 -20% 估
  "apimart.doubao-seedream-4": { kind: "perImage", usd: 0.022 },
  "apimart.doubao-seedream-4-5": { kind: "perImage", usd: 0.025 },
  "apimart.doubao-seedream-5-0-lite": { kind: "perImage", usd: 0.03 },

  // ============ APIMart 视频（USD/秒，720p 基准）============
  "apimart.kling-v3": { kind: "perSecond", usd: 0.023 },
  "apimart.minimax-hailuo-2.3": { kind: "perSecond", usd: 0.04 },
  "apimart.vidu-q3-pro": { kind: "perSecond", usd: 0.05 },
  "apimart.wan2.6": { kind: "perSecond", usd: 0.05, audioSurcharge: 1.2 },
  "apimart.doubao-seedance-1-5-pro": { kind: "perSecond", usd: 0.024, audioSurcharge: 1.2 },
  "apimart.doubao-seedance-2.0-fast": { kind: "perSecond", usd: 0.072, audioSurcharge: 1.3 },
  "apimart.doubao-seedance-2.0": { kind: "perSecond", usd: 0.072, audioSurcharge: 1.3 },
  "apimart.veo3.1-lite": { kind: "perSecond", usd: 0.04, fixedDuration: true },
  "apimart.veo3.1-fast": { kind: "perSecond", usd: 0.08, fixedDuration: true },
  "apimart.sora-2": { kind: "perSecond", usd: 0.10 },
  "apimart.veo3.1-quality": { kind: "perSecond", usd: 0.32, fixedDuration: true }, // premium
  "apimart.sora-2-pro": { kind: "perSecond", usd: 0.40 }, // premium

  // ============ Volcengine 图像（火山官方 CNY/张）============
  "volcengine.doubao-seedream-4-0": { kind: "perImage", usd: 0.20 / USD_TO_CNY },
  "volcengine.doubao-seedream-3-0-t2i": { kind: "perImage", usd: 0.259 / USD_TO_CNY },
  // 5-Lite 未公开单价，按 4 同价兜底
  "volcengine.doubao-seedream-5-0-lite": { kind: "perImage", usd: 0.20 / USD_TO_CNY },

  // ============ Volcengine 视频（按每秒近似，火山实际 token 计费）============
  // Seedance 1.0-pro: 15 元/百万 token，720p 5s 经验值 ~70K token → ~¥1.05 → /5s = ¥0.21/s
  "volcengine.doubao-seedance-1-0-pro": { kind: "perSecond", usd: 0.21 / USD_TO_CNY, audioSurcharge: 1.2 },
  "volcengine.doubao-seedance-1-0-pro-fast": { kind: "perSecond", usd: 0.06 / USD_TO_CNY, audioSurcharge: 1.2 },
  "volcengine.doubao-seedance-1-0-lite": { kind: "perSecond", usd: 0.14 / USD_TO_CNY, audioSurcharge: 1.2 },
  "volcengine.doubao-seedance-2-0": { kind: "perSecond", usd: 0.45 / USD_TO_CNY, audioSurcharge: 1.3 },

  // ============ 文本模型（CNY/次，按典型 5K input + 500 output 估）============
  // 数据来源：5/16 火山实测账单（doubao-seed-2-0-pro 输入¥3.2/M + 输出¥16/M）+ 官方价目表
  // 每月跑 scripts/usage-report 看实际均值后用 o_setting cost.<key> 覆盖即可
  "volcengine.doubao-seed-2-0-pro-260215": { kind: "perTextCall", cny: 0.024 },
  "volcengine.doubao-seed-2-0-pro": { kind: "perTextCall", cny: 0.024 },
  "volcengine.doubao-seed-1-6": { kind: "perTextCall", cny: 0.005 },
  "volcengine.doubao-seed-1-6-lite": { kind: "perTextCall", cny: 0.003 },
  "volcengine.doubao-seed-1-6-vision": { kind: "perTextCall", cny: 0.008 },
  "volcengine.doubao-seed-1-6-flash": { kind: "perTextCall", cny: 0.002 },
  "volcengine.doubao-seed-code": { kind: "perTextCall", cny: 0.010 },
  // apimart 文本（按 USD 直连价 -20% 估）
  "apimart.gpt-5": { kind: "perTextCall", cny: 0.12 * USD_TO_CNY },
  "apimart.gpt-4o": { kind: "perTextCall", cny: 0.038 * USD_TO_CNY },
  "apimart.gpt-4o-mini": { kind: "perTextCall", cny: 0.004 * USD_TO_CNY },
  "apimart.claude-sonnet-4-5": { kind: "perTextCall", cny: 0.048 * USD_TO_CNY },
  "apimart.claude-haiku-4-5": { kind: "perTextCall", cny: 0.018 * USD_TO_CNY },
  "apimart.gemini-2.0-flash": { kind: "perTextCall", cny: 0.001 * USD_TO_CNY },
  "apimart.gemini-2.0-flash-thinking": { kind: "perTextCall", cny: 0.004 * USD_TO_CNY },
};

interface ImageEstimateInput {
  size?: string; // 1K/2K/4K 暂未用，apimart/火山 Seedream 都是同价不分档
  resolution?: string;
  count?: number; // 默认 1，未来批量出图可传 n
}
interface VideoEstimateInput {
  duration: number;
  resolution: string;
  audio?: boolean;
}
interface TextEstimateInput {
  // 暂时不细分 input/output/cached tokens——按 perTextCall 平均价扣
  // 真要按 token 实算（未来）再加 inputTokens/outputTokens/cachedTokens 字段
}

/**
 * 估算模型调用的积分成本。
 *
 * 查找顺序：
 *   1. o_setting 行 key='cost.<vendor>.<model>'（admin 写死，纯数字）
 *   2. MODEL_COSTS[<vendor>.<model>] 按 USD 基准价 + multiplier 算
 *   3. 都没有 → 落回 fallback 函数（一般是按 scene 的 DEFAULT_COSTS 兜底）
 */
export async function estimateCostForModel(
  vendor: string,
  model: string,
  kind: "image" | "video" | "text",
  input: ImageEstimateInput | VideoEstimateInput | TextEstimateInput,
): Promise<number> {
  // 火山所有 modelName 末尾带 6 位日期后缀（如 doubao-seedream-5-0-lite-260128），
  // 但 MODEL_COSTS 主键用不带后缀的稳定版本。这里做两阶段查找：
  //   1) 先用原 model 精确匹配
  //   2) 没命中 → 剥掉 `-{6位日期}` 后缀再查（兼容未来火山更新日期版本）
  // 同样的两阶段也作用于 admin override（admin 写 cost.volcengine.doubao-seedream-5-0-lite
  // 不用关心日期后缀也能匹配上）。
  const exactKey = `${vendor}.${model}`;
  const strippedModel = model.replace(/-\d{6}$/, "");
  const strippedKey = strippedModel !== model ? `${vendor}.${strippedModel}` : null;

  // 1) admin 写死的固定积分价（先精确、再去后缀查一次）
  const overrideKeys = strippedKey
    ? [`${MODEL_COST_KEY_PREFIX}${exactKey}`, `${MODEL_COST_KEY_PREFIX}${strippedKey}`]
    : [`${MODEL_COST_KEY_PREFIX}${exactKey}`];
  const overrideRow = await db("o_setting")
    .whereIn("key", overrideKeys)
    .whereNull("userId")
    .select("key", "value")
    // 排序保证精确匹配优先（精确 key 字符串更长）
    .orderByRaw("LENGTH(key) DESC")
    .first();
  const overridden = overrideRow?.value != null ? Number(overrideRow.value) : NaN;
  if (Number.isFinite(overridden) && overridden >= 0) {
    return Math.max(MIN_CREDITS_PER_CALL, Math.ceil(overridden));
  }

  // 2) MODEL_COSTS 默认表（同样两阶段查找）
  const entry = MODEL_COSTS[exactKey] ?? (strippedKey ? MODEL_COSTS[strippedKey] : undefined);
  if (!entry) return 0; // 调用方决定怎么 fallback

  if (entry.kind === "perImage") {
    const count = (input as ImageEstimateInput).count ?? 1;
    const cnyCost = entry.usd * USD_TO_CNY * count;
    return Math.max(MIN_CREDITS_PER_CALL, Math.ceil(cnyCost * CREDITS_PER_CNY));
  }
  if (entry.kind === "perCall") {
    const cnyCost = entry.usd * USD_TO_CNY;
    return Math.max(MIN_CREDITS_PER_CALL, Math.ceil(cnyCost * CREDITS_PER_CNY));
  }
  if (entry.kind === "perSecond") {
    if (kind !== "video") return 0;
    const v = input as VideoEstimateInput;
    const resTable = entry.resolutionMultiplier ?? DEFAULT_RESOLUTION_MULTIPLIER;
    const resMul = resTable[v.resolution] ?? resTable[v.resolution?.toLowerCase()] ?? 1.0;
    const audioMul = v.audio && entry.audioSurcharge ? entry.audioSurcharge : 1.0;
    const effectiveDuration = entry.fixedDuration ? Math.max(1, v.duration) : v.duration;
    const cnyCost = entry.usd * USD_TO_CNY * effectiveDuration * resMul * audioMul;
    return Math.max(MIN_CREDITS_PER_CALL, Math.ceil(cnyCost * CREDITS_PER_CNY));
  }
  if (entry.kind === "perTextCall") {
    if (kind !== "text") return 0;
    // 文本直接按 CNY × 系数，不走 USD 折算（厂商本来就 ¥ 计价）
    return Math.max(MIN_CREDITS_PER_CALL, Math.ceil(entry.cny * CREDITS_PER_CNY));
  }
  return 0;
}

/**
 * 按模型扣费主入口。调 mixvoice 的 consume API。
 *
 * 与 chargeCredits 的区别：amount 由 estimateCostForModel 算出（而非 getCost(scene)）。
 * 失败抛 InsufficientCreditsError 或通用 Error，调用方自己 catch。
 *
 * 当估出来的 cost=0（模型未在 MODEL_COSTS 里 & admin 也没改价）→ fallback 到 scene。
 */
export async function chargeForModel(opts: {
  userExternalId: string;
  vendor: string;
  model: string;
  kind: "image" | "video" | "text";
  input: ImageEstimateInput | VideoEstimateInput | TextEstimateInput;
  taskId: string;
  fallbackScene?: string; // 没价目时用哪个 scene 兜底，避免新模型上线时扣不到费
}): Promise<{ remaining: number; charged: number }> {
  let cost = await estimateCostForModel(opts.vendor, opts.model, opts.kind, opts.input);
  if (cost <= 0 && opts.fallbackScene) {
    cost = await getCost(opts.fallbackScene);
  }
  if (cost <= 0) return { remaining: -1, charged: 0 };

  const apiUrl = process.env.CREDITS_API_URL;
  const apiToken = process.env.CREDITS_API_TOKEN;
  if (!apiUrl || !opts.userExternalId) {
    return { remaining: -1, charged: 0 };
  }

  // 5xx / 网络中断 / 超时这类瞬时错误，重试 1 次（250ms 后），避开 credits 服务的偶发抖动。
  // 4xx（402/409/400 等业务语义）不重试——重试只会复制语义错误。
  // task_id 是幂等键，重复 POST 同 id 不会重复扣，credits 服务通过 task_id 自己去重。
  const doFetch = () =>
    fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify({
        user_uuid: opts.userExternalId,
        amount: cost,
        scene: `toonflow:${opts.vendor}:${opts.model}`,
        task_id: opts.taskId,
      }),
    });

  let resp: Response;
  try {
    resp = await doFetch();
    if (resp.status >= 500) throw new Error(`HTTP ${resp.status}`);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      resp = await doFetch();
    } catch (e2) {
      // 第二次也失败：吐原始错误（保留 ECONNRESET 等 errno）
      throw new Error(`[credits] chargeForModel 重试后仍失败: ${(e2 as any)?.message ?? e2}`);
    }
  }

  if (resp.status === 402) {
    const body = await resp.json().catch(() => ({} as any));
    throw new InsufficientCreditsError(Number(body?.remaining ?? 0), cost);
  }
  if (resp.status === 409) {
    const body = await resp.json().catch(() => ({} as any));
    return { remaining: Number(body?.remaining ?? -1), charged: 0 };
  }
  if (!resp.ok) {
    throw new Error(`[credits] chargeForModel HTTP ${resp.status} ${resp.statusText}`);
  }
  const body = await resp.json().catch(() => ({} as any));
  return { remaining: Number(body?.remaining ?? -1), charged: cost };
}

/**
 * 调用失败时退款。幂等：同一 task_id 重复调返回 ok 不会再退。
 *
 * 用法：在 vendor 调用 catch 里调一次，无须 await（fire-and-forget 也行，但建议 await
 * 拿到日志便于排查）。env 没配 / userExternalId 缺失时静默 no-op。
 */
export async function refundCharge(opts: {
  userExternalId: string;
  taskId: string;
  reason?: string;
}): Promise<{ refunded: number; remaining: number }> {
  const apiUrl = process.env.CREDITS_API_URL;
  const apiToken = process.env.CREDITS_API_TOKEN;
  if (!apiUrl || !opts.userExternalId) return { refunded: 0, remaining: -1 };
  // refund URL 默认沿 consume 同一前缀，把最后一段换成 refund
  const refundUrl = process.env.CREDITS_REFUND_URL ?? apiUrl.replace(/\/consume$/, "/refund");

  try {
    const resp = await fetch(refundUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify({
        user_uuid: opts.userExternalId,
        task_id: opts.taskId,
        reason: opts.reason ?? "generation failed",
      }),
    });
    if (!resp.ok) {
      console.warn(`[credits] refundCharge HTTP ${resp.status} task=${opts.taskId}`);
      return { refunded: 0, remaining: -1 };
    }
    const body = await resp.json().catch(() => ({} as any));
    return { refunded: Number(body?.refunded ?? 0), remaining: Number(body?.remaining ?? -1) };
  } catch (e: any) {
    console.warn(`[credits] refundCharge network 失败 task=${opts.taskId}: ${e?.message ?? e}`);
    return { refunded: 0, remaining: -1 };
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
