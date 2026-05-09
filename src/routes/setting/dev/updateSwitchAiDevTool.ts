import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf } from "@/utils/ownership";
import { upsertForUser } from "@/utils/perUserSetting";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    switchAiDevTool: z.string(),
  }),
  async (req, res) => {
    const userId = userIdOf(req);
    const { switchAiDevTool } = req.body;
    await upsertForUser("o_setting", userId, { key: "switchAiDevTool" }, { value: switchAiDevTool });
    res.status(200).send(success("保存设置成功"));
  },
);
