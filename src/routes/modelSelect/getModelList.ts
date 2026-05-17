import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf } from "@/utils/ownership";
import { fallthroughList } from "@/utils/perUserSetting";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    type: z.enum(["text", "image", "video", "all"]),
  }),
  async (req, res) => {
    const { type } = req.body;
    // per-user fall-through：每个 vendor.id 只保留一行（用户行优先 → admin 行 → NULL 全局默认），
    // 避免普通用户既有自己的覆盖行又有 NULL 默认行时模型列表重复
    const userId = userIdOf(req);
    const allVendors = await fallthroughList<any>("o_vendorConfig", userId, "id");
    const dataList = allVendors.filter((v) => Number(v.enable) === 1);
    if (!dataList || dataList.length === 0) {
      return res.status(404).send({ error: "模型未找到" });
    }
    const modelList = await Promise.all(dataList.map((i) => u.vendor.getModelList(i.id!)));
    const result = await Promise.all(
      dataList.map(async (data, index) => {
        const vendorData = await u.vendor.getVendor(data.id!);
        const models = modelList[index];
        const filtered =
          type === "all"
            ? models.filter((item: { type: string }) => item.type !== "video")
            : models.filter((item: { type: string }) => item.type === type);
        return filtered.map((item: { name: string; modelName: string; type: string; tier?: string }) => ({
          id: data.id,
          label: item.name,
          value: item.modelName,
          type: item.type,
          name: vendorData.name,
          tier: item.tier, // premium 高消耗模型前端会标红警示
        }));
      }),
    );
    res.status(200).send(success(result.flat()));
  },
);
