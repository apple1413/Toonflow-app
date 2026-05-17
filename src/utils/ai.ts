import { generateText, streamText, wrapLanguageModel, stepCountIs, extractReasoningMiddleware } from "ai";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import axios from "axios";
import { transform } from "sucrase";
import u from "@/utils";
import { getRequestUserId } from "@/utils/requestContext";
import { fallthroughList } from "@/utils/perUserSetting";
import { chargeForModel } from "@/utils/credits";

// 按当前用户找 o_agentDeploy 行：优先用户自己的，没有再 fall through 到 admin(1)/NULL 全局默认。
// 之前的实现是 `.where("key", value).first()`——本地 SQLite 单用户没问题，但在共享 Supabase 上
// 这条 query 会随机返回任意用户的行，导致一个用户的自定义 agent 配置（如 my-custom-name）泄漏
// 给所有人，并在那个 vendor 在当前 Supabase 上不存在时整条 scriptAgent 链路报错。
async function findAgentDeploy(key: string): Promise<{ modelName?: string; [k: string]: any } | null> {
  const userId = getRequestUserId();
  // 没有 user 上下文（启动期/系统任务）的兜底——只看 admin/NULL 全局默认
  if (!userId) {
    const row = await u.db("o_agentDeploy").where({ key }).whereNull("userId").first();
    return row ?? null;
  }
  const rows = await fallthroughList<any>("o_agentDeploy", userId, "key", (q) => q.where("key", key));
  return rows[0] ?? null;
}

/**
 * 文本调用扣费：在 invoke/stream 成功后调一次。
 * 走 perTextCall 平均价，无需 token 实算（每月按账单校准 o_setting 平均值即可）。
 * 失败（throw / cancel）不扣；env 没配 / 用户没 externalId 静默跳过。
 * fire-and-forget：扣费 HTTP 失败不影响 AI 调用结果，只 warn 日志。
 */
async function chargeTextCallSafe(
  vendor: string,
  model: string,
  aiType: string,
  userIdOverride?: number | null,
): Promise<void> {
  // streamText 的 usage Promise 在 AI SDK v5 内部用 raw stream resolve，AsyncLocalStorage
  // 上下文跨不过去 → 这里调用 .then 回调时 getRequestUserId() 返回 null，扣费会被静默跳过。
  // 所以 stream 路径要在外层 ALS 还活着时把 userId 抓出来当参数传进来。
  const userId = userIdOverride ?? getRequestUserId();
  if (!userId) return; // 不是 HTTP 请求触发（如启动期任务）或未登录
  try {
    const userRow = await u.db("o_user").where({ id: userId }).select("externalId").first();
    const externalId = (userRow?.externalId as string) ?? "";
    if (!externalId) return; // 老用户没 externalId 走兼容模式
    // 短 task_id（mixvoice trans_no 列实测上限 ~40 字符，aiType 含冒号不能直接拼）
    // 例: tft1_qjz9c1_a3xy = 16 字符，永远不会超
    const taskId = `tft${userId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await chargeForModel({
      userExternalId: externalId,
      vendor,
      model,
      kind: "text",
      input: {},
      taskId,
      fallbackScene: "text_generation",
    });
  } catch (e: any) {
    console.warn(`[ai.chargeTextCallSafe] 扣费失败 (vendor=${vendor} model=${model}): ${e?.message ?? e}`);
  }
}

type AiType =
  | "scriptAgent"
  | "productionAgent"
  | "universalAi"
  | "scriptAgent:decisionAgent"
  | "scriptAgent:supervisionAgent"
  | "scriptAgent:storySkeletonAgent"
  | "scriptAgent:adaptationStrategyAgent"
  | "scriptAgent:scriptAgent"
  | "productionAgent:decisionAgent"
  | "productionAgent:supervisionAgent"
  | "productionAgent:deriveAssetsAgent"
  | "productionAgent:generateAssetsAgent"
  | "productionAgent:directorPlanAgent"
  | "productionAgent:storyboardGenAgent"
  | "productionAgent:storyboardPanelAgent"
  | "productionAgent:storyboardTableAgent";

type FnName = "textRequest" | "imageRequest" | "videoRequest" | "ttsRequest";

const AiTypeValues: AiType[] = [
  "scriptAgent",
  "productionAgent",
  "universalAi",
  "scriptAgent:decisionAgent",
  "scriptAgent:supervisionAgent",
  "scriptAgent:storySkeletonAgent",
  "scriptAgent:adaptationStrategyAgent",
  "scriptAgent:scriptAgent",
  "productionAgent:decisionAgent",
  "productionAgent:supervisionAgent",
  "productionAgent:deriveAssetsAgent",
  "productionAgent:generateAssetsAgent",
  "productionAgent:directorPlanAgent",
  "productionAgent:storyboardGenAgent",
  "productionAgent:storyboardPanelAgent",
  "productionAgent:storyboardTableAgent",
  "universalAi",
];
// vendor / agent 配置全局共享：所有租户读 userId IS NULL 的全局行
// admin 通过 setting 路由写入，普通用户只读
async function resolveModelName(value: AiType | `${string}:${string}`): Promise<`${string}:${string}`> {
  if (AiTypeValues.includes(value as AiType)) {
    const agentUseModeVal = await u.db("o_setting").where("key", "agentUseMode").first();

    //正常流程
    //高级配置
    if (agentUseModeVal?.value == "1") {
      const agentDeployData = await findAgentDeploy(value);
      if (!agentDeployData?.modelName) throw new Error(`高级配置模式下，未找到对应的模型配置 ${value}`);
      return agentDeployData.modelName as `${number}:${string}`;
    }
    //简易配置
    if (agentUseModeVal?.value == "0") {
      const [mainly] = value!.split(/:(.+)/);
      const mainlyData = await findAgentDeploy(mainly);
      if (!mainlyData?.modelName) throw new Error(`简易配置模式下，未找到部署配置 ${value}`);
      return mainlyData.modelName as `${number}:${string}`;
    }

    //未查到agentUseModeVal 维持原判断
    const agentDeployData = await findAgentDeploy(value);
    let modelName: string | null = null;

    if (!agentDeployData?.modelName) {
      const [mainly] = value!.split(/:(.+)/);
      const mainlyData = await findAgentDeploy(mainly);
      if (!mainlyData?.modelName) throw new Error(`未找到部署配置 ${value}`);
      modelName = mainlyData.modelName;
    }
    modelName = agentDeployData?.modelName || modelName;
    return modelName as `${number}:${string}`;
  }
  return value as `${number}:${string}`;
}

async function getModelConfig(value: AiType | `${string}:${string}`) {
  if (AiTypeValues.includes(value as AiType)) {
    const agentUseModeVal = await u.db("o_setting").where("key", "agentUseMode").first();
    //正常流程
    //高级配置
    if (agentUseModeVal?.value == "1") {
      const agentDeployData = await findAgentDeploy(value);
      if (!agentDeployData?.modelName) throw new Error(`高级配置模式下，未找到对应的模型配置 ${value}`);
      return agentDeployData;
    }
    //简易配置
    if (agentUseModeVal?.value == "0") {
      const [mainly] = value!.split(/:(.+)/);
      const mainlyData = await findAgentDeploy(mainly);
      if (!mainlyData?.modelName) throw new Error(`简易配置模式下，未找到部署配置 ${value}`);
      return mainlyData;
    }

    //未查到 agentUseModelVal 维持原流程
    const agentDeployData = await findAgentDeploy(value);

    if (!agentDeployData?.modelName) {
      const [mainly] = value!.split(/:(.+)/);
      const mainlyData = await findAgentDeploy(mainly);
      if (!mainlyData?.modelName) throw new Error(`未找到部署配置 ${value}`);
      return mainlyData;
    }
    return agentDeployData;
  }
  return null;
}

async function getVendorTemplateFn(
  fnName: "textRequest",
  modelName: `${string}:${string}`,
): Promise<(think?: boolean, thinkLevel?: 0 | 1 | 2 | 3) => any>;
async function getVendorTemplateFn(fnName: Exclude<FnName, "textRequest">, modelName: `${string}:${string}`): Promise<(input: any) => any>;
async function getVendorTemplateFn(fnName: FnName, modelName: `${string}:${string}`): Promise<any> {
  const [id, name] = modelName.split(/:(.+)/);
  const vendorConfigData = await u.db("o_vendorConfig").where("id", id).whereNull("userId").first();
  if (!vendorConfigData) throw new Error(`未找到供应商配置 id=${id}`);
  const modelList = await u.vendor.getModelList(id);
  const selectedModel = modelList.find((i: any) => i.modelName == name);
  if (!selectedModel) throw new Error(`未找到模型 ${name} id=${id}`);
  const code = u.vendor.getCode(id);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const running = u.vm(jsCode);
  if (running.vendor) {
    Object.assign(running.vendor.inputValues, JSON.parse(vendorConfigData.inputValues ?? "{}"));
    running.vendor.models = modelList;
  }
  const fn = running[fnName];
  if (!fn) throw new Error(`未找到供应商配置中的函数 ${fnName} id=${id}`);
  if (fnName == "textRequest")
    return (think?: boolean, thinkLevel: 0 | 1 | 2 | 3 = 0) => {
      const effectiveThink = think ?? !!selectedModel.think;
      return fn(selectedModel, effectiveThink, thinkLevel);
    };
  else return <T>(input: T) => fn(input, selectedModel);
}

async function withTaskRecord<T>(
  modelKey: AiType | `${string}:${string}`,
  taskClass: string,
  describe: string,
  relatedObjects: string,
  projectId: number,
  fn: (modelName: `${string}:${string}`, think: Boolean, thinkLevel: 0 | 1 | 2 | 3) => Promise<T>,
): Promise<T> {
  const modelName = await resolveModelName(modelKey);
  const [_, model] = modelName.split(/:(.+)/);
  const taskRecord = await u.task(projectId, taskClass, model, { describe: describe, content: relatedObjects });
  try {
    const result = await fn(modelName, false, 0);

    taskRecord(1);
    return result;
  } catch (e) {
    taskRecord(-1, u.error(e).message);
    throw new Error(u.error(e).message);
  }
}

async function urlToBase64(url: string, retries = 3, delay = 1000): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url, { responseType: "arraybuffer" });
      const base64 = Buffer.from(res.data).toString("base64");
      return `${base64}`;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((resolve) => setTimeout(resolve, delay * attempt));
    }
  }
  throw new Error("urlToBase64 failed");
}
class AiText {
  private AiType: AiType | `${string}:${string}`;
  private think?: boolean;
  private thinkLevel: 0 | 1 | 2 | 3;
  constructor(AiType: AiType | `${string}:${string}`, think?: boolean, thinkLevel: 0 | 1 | 2 | 3 = 0) {
    this.AiType = AiType;
    this.think = think;
    this.thinkLevel = thinkLevel;
  }
  private async resolveModel(middleware?: any | any[]) {
    const switchAiDevTool = await u.db("o_setting").where("key", "switchAiDevTool").first();
    const modelName = await resolveModelName(this.AiType);
    const sdkFn = await getVendorTemplateFn("textRequest", modelName);
    const baseModel = await sdkFn(this.think, this.thinkLevel);
    const mws = [
      ...(switchAiDevTool?.value === "1" ? [devToolsMiddleware()] : []),
      ...(middleware ? (Array.isArray(middleware) ? middleware : [middleware]) : []),
    ];
    return mws.length > 0 ? wrapLanguageModel({ model: baseModel, middleware: mws.length === 1 ? mws[0] : mws }) : baseModel;
  }
  async invoke(input: Omit<Parameters<typeof generateText>[0], "model">) {
    const config = await getModelConfig(this.AiType);
    // 拿到本次会用的真实 (vendor, model) 拼 USAGE 日志的 key
    const resolved = await resolveModelName(this.AiType);
    const [vendor, model] = resolved.split(/:(.+)/);

    const result = await generateText({
      ...(input.tools && { stopWhen: stepCountIs(Object.keys(input.tools).length * 50) }),
      ...input,
      model: await this.resolveModel(),
      ...(config?.temperature && { temperature: config.temperature }),
      ...(config?.maxOutputTokens && { maxOutputTokens: config.maxOutputTokens }),
    } as Parameters<typeof generateText>[0]);

    // [USAGE] 文本对账：grep '\[USAGE\]' 拉这些行 → 对火山/apimart 控制台账单倒推真实单价
    console.log(
      `[USAGE] ${JSON.stringify({
        vendor,
        model,
        kind: "text",
        aiType: this.AiType,
        usage: (result as any)?.usage ?? null,
        finishReason: (result as any)?.finishReason ?? null,
        ts: Date.now(),
      })}`,
    );
    // 真扣费：按 (vendor, model) 的 perTextCall 平均价，每月按账单校准 o_setting 即可
    void chargeTextCallSafe(vendor, model, String(this.AiType));
    return result;
  }
  async stream(input: Omit<Parameters<typeof streamText>[0], "model">) {
    const config = await getModelConfig(this.AiType);
    const resolved = await resolveModelName(this.AiType);
    const [vendor, model] = resolved.split(/:(.+)/);
    // ALS 在 streamText 的 usage Promise 跨上下文 resolve 时会丢——这里趁还在请求帧里抓住 userId
    const requestUserId = getRequestUserId();

    const result = streamText({
      ...(input.tools && { stopWhen: stepCountIs(Object.keys(input.tools).length * 50) }),
      ...input,
      model: await this.resolveModel(extractReasoningMiddleware({ tagName: "reasoning_content", separator: "\n" })),
      ...(config?.temperature && { temperature: config.temperature }),
      ...(config?.maxOutputTokens && { maxOutputTokens: config.maxOutputTokens }),
    } as Parameters<typeof streamText>[0]);

    // [USAGE] 流式调用：usage 是个 Promise，stream 消费完后才 resolve
    (result as any)?.usage
      ?.then((usage: any) => {
        console.log(
          `[USAGE] ${JSON.stringify({
            vendor,
            model,
            kind: "text",
            aiType: this.AiType,
            usage,
            stream: true,
            ts: Date.now(),
          })}`,
        );
        // 真扣费：在 stream 完全消费完后才扣，避免没用完就扣
        void chargeTextCallSafe(vendor, model, String(this.AiType), requestUserId);
      })
      .catch((e: any) => {
        console.warn(`[USAGE] stream usage 获取失败 model=${resolved}: ${e?.message ?? e}`);
      });

    return result;
  }
}

function referenceList2imageBase642(id: string, input: any) {
  const version = u.vendor.getVendor(id).version;
  if (!version || isNaN(parseFloat(version)) || parseFloat(version) < 2.0) {
    input.imageBase64 = input.referenceList.map((item: any) => item.base64);
    return input;
  }
  return input;
}

export type ReferenceList = { type: "image"; base64: string } | { type: "audio"; base64: string } | { type: "video"; base64: string };

interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}

interface TaskRecord {
  taskClass: string; // 任务分类
  describe: string; // 任务描述
  relatedObjects: string; // 相关对象信息，便于后续分析和追踪
  projectId: number; // 项目ID
}

class AiImage {
  private key: `${string}:${string}`;
  private result: string = "";
  constructor(key: `${string}:${string}`) {
    this.key = key;
  }
  async run(input: ImageConfig, taskRecord?: TaskRecord) {
    const modelName = await resolveModelName(this.key);
    const exec = async (mn: `${string}:${string}`) => {
      const fn = await getVendorTemplateFn("imageRequest", mn);
      await referenceList2imageBase642(mn.split(/:(.+)/)[0], input);
      this.result = await fn(input);
      if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
      return this;
    };
    if (taskRecord) {
      await withTaskRecord(this.key, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
      return this;
    }
    await exec(modelName);
    return this;
  }
  async save(path: string) {
    await u.oss.writeFile(path, this.result);
    return this;
  }
}

type VideoMode =
  | "singleImage" //单图参考
  | "startEndRequired" //首尾帧（两张都得有）
  | "endFrameOptional" //首尾帧（尾帧可选）
  | "startFrameOptional" //首尾帧（首帧可选）
  | "text" //文本
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[]; //多参考（数字代表限制数量）

interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}

class AiVideo {
  private key: `${string}:${string}`;
  private result: string = "";
  constructor(key: `${string}:${string}`) {
    this.key = key;
  }
  async run(input: VideoConfig, taskRecord?: TaskRecord) {
    const modelName = await resolveModelName(this.key);
    try {
      const exec = async (mn: `${string}:${string}`) => {
        const fn = await getVendorTemplateFn("videoRequest", mn);
        await referenceList2imageBase642(mn.split(/:(.+)/)[0], input);

        this.result = await fn(input);

        if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
      };
      if (taskRecord) {
        await withTaskRecord(this.key, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
        return this;
      }
      await exec(modelName);
      return this;
    } catch (e) {
      throw e;
    }
  }
  async save(path: string) {
    await u.oss.writeFile(path, this.result);
    return this;
  }
}
class AiAudio {
  private key: `${string}:${string}`;
  private result: string = "";
  constructor(key: `${string}:${string}`) {
    this.key = key;
  }
  async run(input: VideoConfig, taskRecord?: TaskRecord) {
    const modelName = await resolveModelName(this.key);
    const exec = async (mn: `${string}:${string}`) => {
      try {
        const fn = await getVendorTemplateFn("ttsRequest", mn);
        await referenceList2imageBase642(mn.split(/:(.+)/)[0], input);
        this.result = await fn(input);

        if (this.result.startsWith("http")) this.result = await urlToBase64(this.result);
        return this;
      } catch (e) {}
    };
    if (taskRecord) {
      return withTaskRecord(this.key, taskRecord.taskClass, taskRecord.describe, taskRecord.relatedObjects, taskRecord.projectId, exec);
    }
    return await exec(modelName);
  }
  async save(path: string) {
    await u.oss.writeFile(path, this.result);
    return this;
  }
}

export default {
  Text: (AiType: AiType | `${string}:${string}`, think?: boolean, thinkLevel?: 0 | 1 | 2 | 3) => new AiText(AiType, think, thinkLevel),
  Image: (key: `${string}:${string}`) => new AiImage(key),
  Video: (key: `${string}:${string}`) => new AiVideo(key),
  Audio: (key: `${string}:${string}`) => new AiAudio(key),
};
