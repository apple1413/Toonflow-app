import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { assertAdminAsync } from "@/utils/ownership";
const router = express.Router();

// vendor 配置全局共享：仅 admin 可写，所有租户共用同一份 inputValues（API key 等）
// 落点固定为 userId IS NULL 的全局行；普通用户 403
export default router.post(
  "/",
  validateFields({
    id: z.string(),
    inputValues: z.record(z.string(), z.string()),
  }),
  async (req, res) => {
    await assertAdminAsync(req);
    const { id, inputValues } = req.body;
    // 校验该 vendor 在 vendor 目录里存在（防止任意 id 写入）
    const vendor = u.vendor.getVendor(id);
    if (!vendor) return res.status(404).send(error(`未找到供应商 ${id}`));

    const payload = JSON.stringify(inputValues);
    const existing = await u.db("o_vendorConfig").where({ id }).whereNull("userId").first();
    if (existing) {
      await u.db("o_vendorConfig").where({ id }).whereNull("userId").update({ inputValues: payload });
    } else {
      await u.db("o_vendorConfig").insert({ id, userId: null as any, inputValues: payload });
    }
    res.status(200).send(success("更新成功"));
  },
);
