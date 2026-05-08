import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsAssets } from "@/utils/ownership";
const router = express.Router();

// 批量删除资产
export default router.post(
  "/",
  validateFields({
    id: z.array(z.number()),
  }),
  async (req, res) => {
    const { id } = req.body;
    await assertOwnsAssets(userIdOf(req), id);
    await u.db("o_assets").whereIn("id", id).delete();
    res.status(200).send(success({ message: "删除资产成功" }));
  },
);
