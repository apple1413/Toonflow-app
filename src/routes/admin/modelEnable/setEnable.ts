import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAdminAsync } from "@/utils/ownership";
import { setModelsEnable } from "@/utils/vendor";
const router = express.Router();

// admin 批量设置某 vendor 下若干模型的启用状态。
// body: { vendorId, items: [{modelName, enabled: 0|1|bool}] }
// 也支持单条：{ vendorId, modelName, enabled } → 自动转成 items 单元素
export default router.post(
  "/",
  validateFields({
    vendorId: z.string().min(1),
    modelName: z.string().optional(),
    enabled: z.union([z.boolean(), z.number()]).optional(),
    items: z
      .array(
        z.object({
          modelName: z.string().min(1),
          enabled: z.union([z.boolean(), z.number()]),
        }),
      )
      .optional(),
  }),
  async (req, res) => {
    await assertAdminAsync(req);
    const { vendorId, modelName, enabled, items } = req.body as {
      vendorId: string;
      modelName?: string;
      enabled?: number | boolean;
      items?: Array<{ modelName: string; enabled: number | boolean }>;
    };
    const list = items && items.length > 0
      ? items
      : modelName != null && enabled != null
        ? [{ modelName, enabled }]
        : null;
    if (!list || list.length === 0) {
      return res.status(400).send(error("缺少 items 或 (modelName, enabled)"));
    }
    try {
      await setModelsEnable(vendorId, list);
      res.status(200).send(success(`已更新 ${list.length} 条`));
    } catch (e: any) {
      res.status(500).send(error(e?.message ?? "保存失败"));
    }
  },
);
