import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertAdminAsync } from "@/utils/ownership";
const router = express.Router();

// admin 切换用户的 disabled 状态。禁止自停用、禁止停用最后一个 admin。
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    disabled: z.boolean(),
  }),
  async (req, res) => {
    await assertAdminAsync(req);
    const operatorId = userIdOf(req);
    const { id, disabled } = req.body;
    if (id === operatorId) return res.status(400).send(error("不能停用/启用自己"));

    const target = await u.db("o_user").where({ id }).first();
    if (!target) return res.status(404).send(error("用户不存在"));

    if (disabled && target.role === "admin") {
      // 禁止把最后一个活跃 admin 停掉
      const activeAdmins = await u
        .db("o_user")
        .where({ role: "admin" })
        .andWhere((q) => q.where({ disabled: false }).orWhereNull("disabled"))
        .count("* as c")
        .first();
      const count = Number((activeAdmins as any)?.c ?? 0);
      if (count <= 1) return res.status(400).send(error("不能停用最后一个 admin"));
    }

    await u.db("o_user").where({ id }).update({ disabled });
    res.status(200).send(success(disabled ? "已停用" : "已启用"));
  },
);
