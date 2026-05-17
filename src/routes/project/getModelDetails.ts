import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { getRequestUserId } from "@/utils/requestContext";
import { fallthroughList } from "@/utils/perUserSetting";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    key: z.enum(["scriptAgent", "productionAgent"]),
  }),
  async (req, res) => {
    const { key } = req.body;
    const userId = getRequestUserId();
    let data: any;
    if (!userId) {
      data = await u.db("o_agentDeploy").where({ key }).whereNull("userId").first();
    } else {
      const rows = await fallthroughList<any>("o_agentDeploy", userId, "key", (q) => q.where("key", key));
      data = rows[0];
    }
    if (!data) return res.status(400).send(error("未找到模型"));
    const [id, modelName] = data.modelName.split(/:(.+)/);
    const models = await u.vendor.getModelList(id);
    const model = models.find((m) => m.modelName === modelName);
    if (!model) return res.status(400).send(error("未找到模型"));
    res.status(200).send(success(model));
  },
);
