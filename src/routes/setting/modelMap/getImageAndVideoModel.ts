import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { userIdOf } from "@/utils/ownership";
import { fallthroughList } from "@/utils/perUserSetting";
const router = express.Router();

export default router.post("/", async (req, res) => {
  const userId = userIdOf(req);
  const dataList = await u.db("o_vendorConfig").select("id").where("enable", 1);
  if (!dataList || dataList.length === 0) {
    return res.status(404).send({ error: "模型未找到" });
  }
  const data = await Promise.all(
    dataList.map(async (item) => {
      const vendor = u.vendor.getVendor(item.id!);
      // fall-through：用户自己绑定的 prompt 覆盖 admin 默认；按 (vendorId, model) 联合作业务键
      const promptListRaw = await fallthroughList<any>(
        "o_modelPrompt",
        userId,
        "model",
        (q) => q.andWhere("vendorId", vendor.id),
      );
      const promptMap = new Map(promptListRaw.map((p: any) => [p.model, p.prompt]));
      const models = await u.vendor.getModelList(item.id!);
      const filteredModels = models
        .filter((m: any) => m.type === "video")
        .map((m: any) => ({
          name: m.name,
          type: m.type as "image" | "video",
          model: m.modelName,
          prompt: promptMap.get(m.modelName) ?? "",
        }));
      return {
        id: item.id,
        name: vendor.name,
        promptList: filteredModels,
      };
    }),
  );
  res.status(200).send(success(data));
});
