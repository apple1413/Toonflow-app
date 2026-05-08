import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
import { userIdOf, assertOwnsTask } from "@/utils/ownership";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    taskId: z.number(),
  }),
  async (req, res) => {
    const { taskId } = req.body;
    await assertOwnsTask(userIdOf(req), taskId);
    const data = await u.db("o_tasks").where("id", taskId).select("*").first();
    res.status(200).send(success(data));
  }
);
