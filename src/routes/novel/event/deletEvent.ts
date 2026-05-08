import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsEvent } from "@/utils/ownership";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
  }),
  async (req, res) => {
    const { id } = req.body;
    await assertOwnsEvent(userIdOf(req), id);

    await u.db("o_event").where("id", id).del();
    await u.db("o_eventChapter").where("eventId", id).del();

    res.status(200).send(success({ message: "删除事件成功" }));
  },
);
