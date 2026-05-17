import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { assertAdmin } from "@/utils/ownership";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.string(),
    modelName: z.string(),
  }),
  async (req, res) => {
    assertAdmin(req);
    const { id, modelName } = req.body;

    const row = await u.db("o_vendorConfig").where("id", id).whereNull("userId").first("models");
    if (row?.models) {
      const existingModels = JSON.parse(row.models);
      if (!existingModels.some((model: any) => model.modelName === modelName)) {
        return res.status(400).send(error("基本模型不允许删除"));
      }
      const updatedModels = existingModels.filter((model: any) => model.modelName !== modelName);
      await u
        .db("o_vendorConfig")
        .where("id", id)
        .whereNull("userId")
        .update({
          models: JSON.stringify(updatedModels),
        });
    }
    res.status(200).send(success("更新成功"));
  },
);
