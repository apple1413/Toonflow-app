import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAdminAsync } from "@/utils/ownership";
import { getModelListWithEnabled } from "@/utils/vendor";
import db from "@/utils/db";
const router = express.Router();

// admin 列出指定 vendor 的全部模型 + 启用状态。
// 不传 vendorId → 返回所有已启用 vendor 的合集（用于全局 toggle 页面）。
export default router.post(
  "/",
  validateFields({
    vendorId: z.string().optional(),
  }),
  async (req, res) => {
    await assertAdminAsync(req);
    const { vendorId } = req.body as { vendorId?: string };
    try {
      if (vendorId) {
        const list = await getModelListWithEnabled(vendorId);
        return res.status(200).send(success({ vendorId, models: list }));
      }
      const vendors = await db("o_vendorConfig").whereNull("userId").where("enable", 1).select("id");
      const result = await Promise.all(
        vendors
          .filter((v): v is { id: string } => typeof v.id === "string" && v.id.length > 0)
          .map(async (v) => ({
            vendorId: v.id,
            models: await getModelListWithEnabled(v.id),
          })),
      );
      res.status(200).send(success(result));
    } catch (e: any) {
      res.status(500).send(error(e?.message ?? "读取失败"));
    }
  },
);
