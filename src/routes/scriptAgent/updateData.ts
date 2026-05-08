import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsProject } from "@/utils/ownership";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    data: z.object({
      storySkeleton: z.string(),
      adaptationStrategy: z.string(),
      script: z.array(
        z.object({
          id: z.number(),
          content: z.string(),
        }),
      ),
    }),
  }),
  async (req, res) => {
    const { id, data } = req.body;
    // o_agentWorkData 没有直接的 ownership helper，先反查 projectId 再 assertOwnsProject
    const row = await u.db("o_agentWorkData").where({ id }).select("projectId").first();
    if (!row || row.projectId == null) return res.status(403).send(error("agent 工作数据不存在或无关联项目"));
    await assertOwnsProject(userIdOf(req), row.projectId);
    await u
      .db("o_agentWorkData")
      .where({ id: id })
      .update({
        data: JSON.stringify(data),
      });
    res.status(200).send(success("更新成功"));
  },
);
