/**
 * APIMart 供应商适配
 * 文档：https://docs.apimart.ai/cn
 * 接口规约：
 *   - 文本：POST /v1/chat/completions（OpenAI 兼容）
 *   - 图像：POST /v1/images/generations （异步，返回 task_id）
 *   - 视频：POST /v1/videos/generations （异步，返回 task_id）
 *   - 任务：GET  /v1/tasks/{task_id}   （统一轮询入口）
 *   - 鉴权：Authorization: Bearer <API_KEY>
 * @version 1.0
 */

// ============================================================
// 类型定义
// ============================================================

type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];

interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
}

interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}

interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
  tier?: "free" | "premium"; // premium=单次扣 1000+ 积分，前端建议红字警示 / admin-only
}

interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}

interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}

type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
  referenceList?: Extract<ReferenceList, { type: "audio" }>[];
}

interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}

// ============================================================
// 全局声明
// ============================================================

declare const axios: any;
declare const logger: (msg: string) => void;
declare const jsonwebtoken: any;
declare const zipImage: (base64: string, size: number) => Promise<string>;
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>;
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};

// ============================================================
// 供应商配置
// ============================================================

const vendor: VendorConfig = {
  id: "apimart",
  version: "1.0",
  author: "Toonflow",
  name: "APIMart",
  description:
    "## APIMart\n\nAPIMart 多模态 AI 模型聚合平台，OpenAI 兼容接口。集中接入 GPT-5 / Claude 4.5 / Gemini / Sora 2 / Veo 3.1 / Kling v3 / Wan 2.6 / Seedance 2.0 / Hailuo / Vidu 等主流文本、图像、视频模型，统一计费、统一鉴权。\n\n🔗 [文档中心](https://docs.apimart.ai/cn) · [获取 API Key](https://apimart.ai/keys)",
  icon: "",
  inputs: [{ key: "apiKey", label: "API密钥", type: "password", required: true }],
  inputValues: {
    apiKey: "",
    baseUrl: "https://api.apimart.ai/v1",
  },
  models: [
    // ========== 文本 ==========
    { name: "GPT-5", modelName: "gpt-5", type: "text", think: false },
    { name: "GPT-4o", modelName: "gpt-4o", type: "text", think: false },
    { name: "GPT-4o Mini", modelName: "gpt-4o-mini", type: "text", think: false },
    { name: "Claude Sonnet 4.5", modelName: "claude-sonnet-4-5", type: "text", think: false },
    { name: "Claude Haiku 4.5", modelName: "claude-haiku-4-5", type: "text", think: false },
    { name: "Gemini 2.0 Flash", modelName: "gemini-2.0-flash", type: "text", think: false },
    { name: "Gemini 2.0 Flash Thinking", modelName: "gemini-2.0-flash-thinking", type: "text", think: true },

    // ========== 图像 ==========
    { name: "GPT-Image-2", modelName: "gpt-image-2", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { name: "Doubao Seedream 5.0 Lite", modelName: "doubao-seedream-5-0-lite", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { name: "Doubao Seedream 4.5", modelName: "doubao-seedream-4-5", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { name: "Doubao Seedream 4", modelName: "doubao-seedream-4", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { name: "Gemini 3 Pro Image", modelName: "gemini-3-pro-image", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { name: "Gemini 2.5 Flash Image (Nano Banana)", modelName: "gemini-2.5-flash-image", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { name: "Qwen Image", modelName: "qwen-image", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { name: "Imagen 4.0", modelName: "imagen-4.0", type: "image", mode: ["text"] },

    // ========== 视频 ==========
    {
      name: "Sora 2 Pro",
      type: "video",
      modelName: "sora-2-pro",
      mode: ["text", "singleImage"],
      durationResolutionMap: [{ duration: [4, 8, 12, 16, 20], resolution: ["720p", "1080p"] }],
      audio: true,
      tier: "premium",
    },
    {
      name: "Sora 2",
      type: "video",
      modelName: "sora-2",
      mode: ["text", "singleImage"],
      durationResolutionMap: [{ duration: [4, 8, 12, 16, 20], resolution: ["720p", "1080p"] }],
      audio: true,
    },
    {
      name: "Veo 3.1 Quality",
      type: "video",
      modelName: "veo3.1-quality",
      mode: ["text", "singleImage"],
      durationResolutionMap: [{ duration: [8], resolution: ["720p", "1080p"] }],
      audio: true,
      tier: "premium",
    },
    {
      name: "Veo 3.1 Fast",
      type: "video",
      modelName: "veo3.1-fast",
      mode: ["text", "singleImage"],
      durationResolutionMap: [{ duration: [8], resolution: ["720p", "1080p"] }],
      audio: true,
    },
    {
      name: "Kling v3",
      type: "video",
      modelName: "kling-v3",
      mode: ["text", "singleImage", "startEndRequired"],
      durationResolutionMap: [{ duration: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["720p", "1080p"] }],
      audio: "optional",
    },
    {
      name: "Wan 2.6",
      type: "video",
      modelName: "wan2.6",
      mode: ["text", "singleImage"],
      durationResolutionMap: [{ duration: [5, 10, 15], resolution: ["720p", "1080p"] }],
      audio: "optional",
    },
    {
      name: "Doubao Seedance 2.0",
      type: "video",
      modelName: "doubao-seedance-2.0",
      mode: ["text", "singleImage", "endFrameOptional"],
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p", "1080p"] }],
      audio: "optional",
    },
    {
      name: "Doubao Seedance 2.0 Fast",
      type: "video",
      modelName: "doubao-seedance-2.0-fast",
      mode: ["text", "singleImage", "endFrameOptional"],
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolution: ["480p", "720p", "1080p"] }],
      audio: "optional",
    },
    {
      name: "Doubao Seedance 1.5 Pro",
      type: "video",
      modelName: "doubao-seedance-1-5-pro",
      mode: ["text", "endFrameOptional"],
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8, 9, 10, 11, 12], resolution: ["480p", "720p", "1080p"] }],
      audio: true,
    },
    {
      name: "MiniMax Hailuo 2.3",
      type: "video",
      modelName: "minimax-hailuo-2.3",
      mode: ["text", "singleImage"],
      durationResolutionMap: [{ duration: [6, 10], resolution: ["768p", "1080p"] }],
      audio: false,
    },
    {
      name: "Vidu Q3 Pro",
      type: "video",
      modelName: "vidu-q3-pro",
      mode: ["singleImage", "startEndRequired"],
      durationResolutionMap: [{ duration: [4, 5, 6, 7, 8], resolution: ["720p", "1080p"] }],
      audio: false,
    },
  ],
};

// ============================================================
// 辅助函数
// ============================================================

// 从 /v1/tasks/{task_id} 拉结果，apimart 所有异步生成都走这一个入口
async function pollApimartTask(
  taskId: string,
  baseUrl: string,
  apiKey: string,
  kind: "image" | "video",
  modelName: string,
  extra?: Record<string, any>,
): Promise<string> {
  const res = await pollTask(async () => {
    const r = await fetch(`${baseUrl}/tasks/${taskId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`轮询失败 ${r.status}: ${errText}`);
    }
    const j = await r.json();
    const data = j?.data ?? {};
    const status = data?.status;
    if (status === "completed" || status === "success") {
      const result = data?.result ?? {};
      let url: string | undefined;
      if (kind === "image") {
        const first = (result?.images ?? [])[0];
        const u = first?.url;
        url = Array.isArray(u) ? u[0] : typeof u === "string" ? u : first?.image_url;
      } else {
        const first = (result?.videos ?? [])[0];
        if (typeof first === "string") {
          url = first;
        } else {
          const u = first?.url ?? first?.video_url;
          url = Array.isArray(u) ? u[0] : u;
        }
      }
      if (!url) return { completed: true, error: `任务已完成但未返回 ${kind} URL` };
      // [USAGE] 实测对账：grep '\[USAGE\]' 拉这些行 → 对 apimart 控制台账单倒推真实单价
      // apimart 的 /v1/tasks 响应里如果带 usage / cost 等字段，会一并透传出来
      logger(
        `[USAGE] ${JSON.stringify({
          vendor: "apimart",
          model: modelName,
          kind,
          taskId,
          usage: data?.usage ?? null,
          cost: data?.cost ?? null,
          actualTime: data?.actual_time ?? null,
          ...extra,
          ts: Date.now(),
        })}`,
      );
      return { completed: true, data: url };
    }
    if (status === "failed" || status === "cancelled") {
      const msg = data?.error?.message ?? data?.message ?? `${kind} 生成失败`;
      return { completed: true, error: msg };
    }
    return { completed: false };
  });
  if (res.error) throw new Error(res.error);
  return res.data!;
}

// 内部映射：toonflow 的 "1K/2K/4K" 转 apimart 各模型的 resolution 取值
function mapImageResolution(modelName: string, size: "1K" | "2K" | "4K"): string {
  const lower = modelName.toLowerCase();
  if (lower.includes("seedream")) return size === "4K" ? "3K" : "2K"; // seedream 仅 2K/3K
  if (lower.includes("gpt-image")) return size.toLowerCase(); // 1k/2k/4k
  // 兜底：小写化（适用于 wan2.7-image 等）
  return size.toLowerCase();
}

// ============================================================
// 适配器
// ============================================================

const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return createOpenAI({ baseURL: vendor.inputValues.baseUrl, apiKey }).chat(model.modelName);
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const baseUrl = vendor.inputValues.baseUrl;
  const imageBase64List = (config.referenceList ?? []).map((r) => r.base64);

  const body: Record<string, any> = {
    model: model.modelName,
    prompt: config.prompt,
    size: config.aspectRatio,
    resolution: mapImageResolution(model.modelName, config.size),
    n: 1,
  };
  if (imageBase64List.length) body.image_urls = imageBase64List;

  logger(`[apimart.imageRequest] 提交图片任务 model=${model.modelName} refs=${imageBase64List.length}`);
  const submit = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    const errText = await submit.text();
    throw new Error(`图像提交失败 ${submit.status}: ${errText}`);
  }
  const sj = await submit.json();
  const taskId: string | undefined = sj?.data?.[0]?.task_id ?? sj?.task_id ?? sj?.data?.task_id;
  if (!taskId) throw new Error(`未拿到 task_id: ${JSON.stringify(sj)}`);
  logger(`[apimart.imageRequest] taskId=${taskId}`);

  const url = await pollApimartTask(taskId, baseUrl, apiKey, "image", model.modelName, {
    size: body.size,
    resolution: body.resolution,
    refsCount: imageBase64List.length,
  });
  return await urlToBase64(url);
};

const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少 API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  const baseUrl = vendor.inputValues.baseUrl;
  const lowerName = model.modelName.toLowerCase();
  const imageRefs = (config.referenceList ?? []).filter((r) => r.type === "image").map((r) => r.base64);

  const body: Record<string, any> = {
    model: model.modelName,
    prompt: config.prompt,
    duration: config.duration,
  };

  // 长宽比字段：seedance 系列用 size，其余用 aspect_ratio
  if (lowerName.includes("seedance")) body.size = config.aspectRatio;
  else body.aspect_ratio = config.aspectRatio;

  // 分辨率字段：kling 用 mode（std/pro/4k），其余直接 resolution
  if (lowerName.includes("kling")) {
    if (config.resolution === "4k" || config.resolution === "4K") body.mode = "4k";
    else if (config.resolution === "1080p") body.mode = "pro";
    else body.mode = "std";
  } else {
    body.resolution = config.resolution;
  }

  // 音频字段：seedance 用 generate_audio，其余用 audio
  if (typeof config.audio === "boolean") {
    if (lowerName.includes("seedance")) body.generate_audio = config.audio;
    else body.audio = config.audio;
  }

  // 参考图：apimart 统一 image_urls
  if (imageRefs.length) body.image_urls = imageRefs;

  logger(`[apimart.videoRequest] 提交视频任务 model=${model.modelName} refs=${imageRefs.length} dur=${config.duration}s`);
  const submit = await fetch(`${baseUrl}/videos/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!submit.ok) {
    const errText = await submit.text();
    throw new Error(`视频提交失败 ${submit.status}: ${errText}`);
  }
  const sj = await submit.json();
  const taskId: string | undefined = sj?.data?.[0]?.task_id ?? sj?.task_id ?? sj?.data?.task_id;
  if (!taskId) throw new Error(`未拿到 task_id: ${JSON.stringify(sj)}`);
  logger(`[apimart.videoRequest] taskId=${taskId}`);

  const url = await pollApimartTask(taskId, baseUrl, apiKey, "video", model.modelName, {
    duration: config.duration,
    resolution: config.resolution,
    audio: !!config.audio,
    refsCount: imageRefs.length,
  });
  return await urlToBase64(url);
};

const ttsRequest = async (_config: TTSConfig, _model: TTSModel): Promise<string> => {
  return "";
};

const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "1.0", notice: "" };
};

const updateVendor = async (): Promise<string> => {
  return "";
};

// ============================================================
// 导出
// ============================================================

exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;

export {};
