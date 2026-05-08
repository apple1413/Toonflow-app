import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsImage } from "@/utils/ownership";
const router = express.Router();

// 取消生成（id 是 o_image 的主键）
export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    await assertOwnsImage(userIdOf(req), id);
    await u.db("o_image").where("id", id).update({
      state: "生成失败",
    });
    res.status(200).send(success({ message: "取消成功" }));
  },
);
