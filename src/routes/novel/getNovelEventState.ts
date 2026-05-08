import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsNovels } from "@/utils/ownership";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number()),
  }),
  async (req, res) => {
    const { ids } = req.body;
    await assertOwnsNovels(userIdOf(req), ids);
    const data = await u.db("o_novel").whereIn("id", ids).whereNot("eventState", 0).select("id", "event", "eventState", "errorReason");
    res.status(200).send(success(data));
  },
);
