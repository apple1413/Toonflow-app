import express from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { userIdOf } from "@/utils/ownership";
import { upsertForUser } from "@/utils/perUserSetting";
const router = express.Router();

// per-user：业务键 (vendorId, model)；写仅写当前用户行，admin 默认行不动
export default router.post(
  "/",
  validateFields({
    vendorId: z.string(),
    model: z.string(),
    prompt: z.string(),
  }),
  async (req, res) => {
    const userId = userIdOf(req);
    const { vendorId, model, prompt } = req.body;
    await upsertForUser("o_modelPrompt", userId, { vendorId, model }, { prompt });
    res.status(200).send(success("绑定成功"));
  },
);
