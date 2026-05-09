import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertAdminAsync } from "@/utils/ownership";
const router = express.Router();

// admin 提升/降级别人的 role。禁止自降级、禁止降最后一个 admin。
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    role: z.enum(["admin", "user"]),
  }),
  async (req, res) => {
    await assertAdminAsync(req);
    const operatorId = userIdOf(req);
    const { id, role } = req.body;
    if (id === operatorId && role !== "admin") {
      return res.status(400).send(error("不能降级自己的 admin 角色"));
    }

    const target = await u.db("o_user").where({ id }).first();
    if (!target) return res.status(404).send(error("用户不存在"));

    if (target.role === "admin" && role !== "admin") {
      const activeAdmins = await u
        .db("o_user")
        .where({ role: "admin" })
        .andWhere((q) => q.where({ disabled: false }).orWhereNull("disabled"))
        .count("* as c")
        .first();
      const count = Number((activeAdmins as any)?.c ?? 0);
      if (count <= 1) return res.status(400).send(error("不能降级最后一个 admin"));
    }

    await u.db("o_user").where({ id }).update({ role });
    res.status(200).send(success(`角色已更新为 ${role}`));
  },
);
