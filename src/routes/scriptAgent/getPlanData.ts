import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsProject } from "@/utils/ownership";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    agentType: z.enum(["scriptAgent"]),
  }),
  async (req, res) => {
    const { projectId, agentType } = req.body;
    const userId = userIdOf(req);
    await assertOwnsProject(userId, projectId);
    const row = await u.db("o_agentWorkData").where({ projectId: projectId, key: agentType }).first();

    if (!row) {
      const [id] = await u.db("o_agentWorkData").insert({
        projectId: projectId,
        userId,
        key: agentType,
        data: JSON.stringify({
          storySkeleton: "",
          adaptationStrategy: "",
        }),
      });
      return res.status(200).send(
        success({
          data: {
            storySkeleton: "",
            adaptationStrategy: "",
          },
          id
        }),
      );
    }
    const data = JSON.parse(row.data ?? "{}");
    data.script = await u.db("o_script").where({ projectId }).select("id", "name", "content");

    res.status(200).send(success({ data, id: row.id }));
  },
);
