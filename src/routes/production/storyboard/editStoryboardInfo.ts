import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { id } from "zod/locales";
import { userIdOf, assertOwnsStoryboard } from "@/utils/ownership";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    prompt: z.string(),
    videoDesc: z.string(),
  }),
  async (req, res) => {
    const { id, prompt, videoDesc } = req.body;
    await assertOwnsStoryboard(userIdOf(req), id);
    await u.db("o_storyboard").where({ id }).update({
      prompt,
      videoDesc,
    });
    res.status(200).send(success({ message: "更新提示词成功" }));
  },
);
