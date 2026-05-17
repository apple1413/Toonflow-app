import { tool, jsonSchema, Tool } from "ai";
import { z } from "zod";
import _ from "lodash";
import ResTool from "@/socket/resTool";
import u from "@/utils";
import { insertReturnId } from "@/utils/insertReturnId";

const deriveAssetSchema = z.object({
  id: z.number().describe("衍生资产ID,如果新增则为空"),
  assetsId: z.number().describe("关联的资产ID"),
  prompt: z.string().describe("生成提示词"),
  name: z.string().describe("衍生资产名称"),
  desc: z.string().describe("衍生资产描述"),
  src: z.string().nullable().describe("衍生资产资源路径"),
  state: z.enum(["未生成", "生成中", "已完成", "生成失败"]).describe("衍生资产生成状态"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("衍生资产类型"),
});
export const assetItemSchema = z.object({
  id: z.number().describe("资产唯一标识"),
  name: z.string().describe("资产名称"),
  type: z.enum(["role", "tool", "scene", "clip"]).describe("资产类型"),
  prompt: z.string().describe("生成提示词"),
  desc: z.string().describe("资产描述"),
  derive: z.array(deriveAssetSchema).describe("衍生资产列表"),
});
const storyboardSchema = z.object({
  id: z.number().describe("分镜ID，必须为真实id"),
  duration: z.number().describe("持续时长(秒)"),
  prompt: z.string().describe("生成提示词"),
  associateAssetsIds: z.array(z.number()).describe("关联资产ID列表"),
  src: z.string().nullable().describe("分镜资源路径"),
  index: z.number().nullable().optional().describe("分镜排序字段"),
});
const workbenchDataSchema = z.object({
  name: z.string().describe("项目名称"),
  duration: z.string().describe("视频时长"),
  resolution: z.string().describe("分辨率"),
  fps: z.string().describe("帧率"),
  cover: z.string().optional().describe("封面图片路径"),
  gradient: z.string().optional().describe("渐变色配置"),
});
const posterItemSchema = z.object({
  id: z.number().describe("海报ID"),
  image: z.string().describe("海报图片路径"),
});
export const flowDataSchema = z.object({
  script: z.string().describe("剧本内容"),
  scriptPlan: z.string().describe("拍摄计划"),
  assets: z.array(assetItemSchema).describe("衍生资产"),
  storyboardTable: z.string().describe("分镜表"),
  storyboard: z.array(storyboardSchema).describe("分镜面板"),
});

export type FlowData = z.infer<typeof flowDataSchema>;

const keySchema = z.enum(Object.keys(flowDataSchema.shape) as [keyof FlowData, ...Array<keyof FlowData>]);
const flowDataKeyLabels = Object.fromEntries(
  Object.entries(flowDataSchema.shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).description ?? key]),
) as Record<keyof FlowData, string>;

interface ToolConfig {
  resTool: ResTool;
  toolsNames?: string[];
  msg: ReturnType<ResTool["newMessage"]>;
}

export default (toolCpnfig: ToolConfig) => {
  const { resTool, toolsNames, msg } = toolCpnfig;
  const { socket } = resTool;
  const tools: Record<string, Tool> = {
    get_flowData: tool({
      description: "获取工作区数据",
      inputSchema: jsonSchema<{ key: keyof FlowData }>(
        z
          .object({
            key: keySchema.describe("数据key"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ key }) => {
        const thinking = msg.thinking(`正在获取${flowDataKeyLabels[key]}工作区数据...`);
        console.log("[tools] get_flowData", key);
        const flowData: FlowData = await new Promise((resolve) => socket.emit("getFlowData", { key }, (res: any) => resolve(res)));
        thinking.appendText(`获取到${flowDataKeyLabels[key]}:\n` + JSON.stringify(flowData[key], null, 2));
        thinking.updateTitle(`获取${flowDataKeyLabels[key]}完成`);
        thinking.complete();
        return flowData[key];
      },
    }),
    add_deriveAsset: tool({
      description: "新增或更新衍生资产",
      inputSchema: jsonSchema<{ assetsId: number; id: number | null; name: string; desc: string }>(
        z
          .object({
            assetsId: z.number().describe("关联的资产ID"),
            id: z.number().nullable().describe("衍生资产ID,如果新增则为空"),
            name: z.string().describe("衍生资产名称"),
            desc: z.string().describe("衍生资产描述"),
          })
          .toJSONSchema(),
      ),
      execute: async (raw) => {
        // 容错：LLM 偶尔传 "null" 字符串、空串、0、负数当作"新增"——统一归 null。
        // 之前漏判 0 → 直接把 id=0 塞进 INSERT，SQLite 允许导致出现 id=0 的脏数据，
        // 后续 generate_deriveAsset 拿这个 id 调下游路由全部 403 / 永远不生图。
        const idRaw = raw.id as unknown;
        const idNum = typeof idRaw === "number" ? idRaw : Number(idRaw);
        const normalizedId =
          idRaw === "null" || idRaw === "" || idRaw == null || !Number.isFinite(idNum) || idNum <= 0
            ? null
            : idNum;
        const deriveAsset = { ...raw, id: normalizedId };

        const thinking = msg.thinking("正在操作资产...");
        const { projectId, scriptId } = resTool.data;
        const startTime = Date.now();
        const parentAssets = await u.db("o_assets").where("id", deriveAsset.assetsId).select("id", "type").first();
        if (!parentAssets) return "关联的资产不存在";

        // INSERT 路径绝对不要带 id 字段（哪怕 undefined），交给 DB ROWID 自增。
        // 早期实现把 `id: undefined` 一路传到底，再加上 0 没被归一，是 id=0 脏数据的根因。
        const baseRow = {
          assetsId: deriveAsset.assetsId,
          projectId,
          name: deriveAsset.name,
          type: parentAssets.type,
          describe: deriveAsset.desc,
          startTime,
        };

        let finalId: number;
        if (deriveAsset.id) {
          await u.db("o_assets").where("id", deriveAsset.id).update(baseRow);
          finalId = deriveAsset.id;
          thinking.appendText(`已更新衍生资产，ID: ${finalId}\n`);
        } else {
          finalId = await insertReturnId("o_assets", baseRow);
          await u.db("o_scriptAssets").insert({ scriptId, assetId: finalId });
          thinking.appendText(`已新增衍生资产，ID: ${finalId}\n`);
        }

        const data = { ...baseRow, id: finalId };
        const res: any = await new Promise((resolve) => socket.emit("addDeriveAsset", data, (r: any) => resolve(r)));
        thinking.updateTitle("资产操作完成");
        thinking.complete();
        // 把真实 id 明示返回给 LLM——之前只回 socket 的 success/message 文案，LLM 拿不到准确 id
        // 就会用旧 id（或瞎编一个 0）去调 generate_deriveAsset
        const baseMsg = typeof res === "string" ? res : res?.message ?? "操作成功";
        return `${baseMsg}（衍生资产真实ID = ${finalId}，后续生成请使用此ID）`;
      },
    }),
    del_deriveAsset: tool({
      description: "删除衍生资产",
      inputSchema: jsonSchema<{ assetsId: number; id: number }>(
        z
          .object({
            assetsId: z.number().describe("关联的资产ID"),
            id: z.number().describe("衍生资产ID"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ assetsId, id }) => {
        const thinking = msg.thinking("正在操作资产...");
        const { scriptId } = resTool.data;
        await u.db("o_assets").where("id", id).del();
        await u.db("o_scriptAssets").where({ scriptId, assetId: id }).del();
        thinking.appendText(`已删除衍生资产，ID: ${id}\n`);
        const res = await new Promise((resolve) => socket.emit("delDeriveAsset", { assetsId, id }, (res: any) => resolve(res)));
        thinking.updateTitle("资产操作完成");
        thinking.complete();
        return res ?? "删除成功";
      },
    }),
    generate_deriveAsset: tool({
      description: "生成衍生资产图片",
      inputSchema: jsonSchema<{ ids: number[] }>(
        z
          .object({
            ids: z.array(z.number()).describe("需要生成的 衍生资产ID"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ ids }) => {
        const thinking = msg.thinking("正在生成衍生资产...");
        const { projectId } = resTool.data;

        // LLM 经常幻觉 id（之前观察过：聊天里说"已写入 7 条"，DB 实际只入 2 条，
        // 但 LLM 又把 7 个 id 全传到这里）。任何一个不存在/属错项目都会让下游
        // assertOwnsAssets 直接整批 403，前端永远看不到生成进度。
        // 这里先和 DB 对账，只把"真实存在 + 属当前项目 + 是衍生资产（有父）"的 id 放行。
        const rawIds = Array.isArray(ids) ? ids.filter((v) => Number.isFinite(v) && v > 0) : [];
        let validIds: number[] = [];
        if (rawIds.length) {
          const rows = await u
            .db("o_assets")
            .whereIn("id", rawIds)
            .andWhere("projectId", projectId)
            .whereNotNull("assetsId")
            .pluck("id");
          validIds = rows.map((r: any) => Number(r));
        }
        const droppedIds = rawIds.filter((id) => !validIds.includes(Number(id)));
        if (droppedIds.length) {
          thinking.appendText(`已忽略不存在或非本项目的衍生资产ID: ${droppedIds.join(", ")}\n`);
        }
        if (!validIds.length) {
          thinking.appendText("没有可生成的衍生资产，请先调用 add_deriveAsset 把衍生资产真实入库后再调用本工具。\n");
          thinking.updateTitle("衍生资产生成跳过");
          thinking.complete();
          return `没有可生成的衍生资产（输入 ids=${rawIds.join(",")} 中没有任何一条在 DB 中真实存在）`;
        }

        new Promise((resolve) => socket.emit("generateDeriveAsset", { ids: validIds }, (res: any) => resolve(res)))
          .then((res) => {
            thinking.appendText(`已生成衍生资产，ID: ${JSON.stringify(res, null, 2)}\n`);
            thinking.updateTitle("衍生资产开始完成");
            thinking.complete();
          })
          .catch((e) => {
            thinking.appendText("衍生资产生成失败:\n" + u.error(e).message);
            thinking.updateTitle("衍生资产生成失败");
            thinking.complete();
          });

        return `开始生成衍生资产（有效ID = ${validIds.join(",")}${droppedIds.length ? `，已忽略 ${droppedIds.join(",")}` : ""}）`;
      },
    }),
    generate_storyboard: tool({
      description: "生成分镜图片",
      inputSchema: jsonSchema<{ ids: number[] }>(
        z
          .object({
            ids: z.array(z.number()).describe("必须获取真实的分镜ID，支持批量生成"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ ids }) => {
        const thinking = msg.thinking("正在生成分镜...");
        new Promise((resolve) => socket.emit("generateStoryboard", { ids }, (res: any) => resolve(res)))
          .then((res) => {
            thinking.appendText("生成的分镜数据:\n" + JSON.stringify(res, null, 2));
            thinking.updateTitle("分镜生成完成");
            thinking.complete();
          })
          .catch((e) => {
            thinking.appendText("分镜生成失败:\n" + u.error(e).message);
            thinking.updateTitle("分镜生成失败");
            thinking.complete();
          });

        return "开始生成分镜";
      },
    }),
  };

  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};
