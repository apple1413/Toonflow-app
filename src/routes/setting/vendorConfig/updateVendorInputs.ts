import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { transform } from "sucrase";
import { userIdOf } from "@/utils/ownership";
import { upsertForUser } from "@/utils/perUserSetting";
const router = express.Router();

// per-user：每个用户写自己的 inputValues 行（不动全局 NULL 默认）
export default router.post(
  "/",
  validateFields({
    id: z.string(),
    inputValues: z.record(z.string(), z.string()),
  }),
  async (req, res) => {
    const userId = userIdOf(req);
    const { id, inputValues } = req.body;
    // 校验该 vendor 在 vendor 目录里存在（防止任意 id 写入）
    const vendor = u.vendor.getVendor(id);
    if (!vendor) return res.status(404).send(error(`未找到供应商 ${id}`));

    await upsertForUser("o_vendorConfig", userId, { id }, {
      inputValues: JSON.stringify(inputValues),
    });
    res.status(200).send(success("更新成功"));
  },
);
