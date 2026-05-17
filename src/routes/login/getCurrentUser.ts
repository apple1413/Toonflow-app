import express from "express";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { userIdOf } from "@/utils/ownership";

const router = express.Router();

/**
 * 取当前登录用户的完整信息（id / name / role / externalId / email / disabled）。
 * 前端用来做权限分支（如 sidebar 设置按钮只对 admin 显示）。
 *
 * JWT payload 只签了 { id, name }，所以前端拿不到 role / externalId —— 必须走这个接口。
 * 不返回 password，避免在 P0 修复后再次回归。
 */
export default router.post("/", async (req, res) => {
  const userId = userIdOf(req);
  if (!userId) return res.status(401).send(error("未登录"));

  const user = await u
    .db("o_user")
    .where({ id: userId })
    .select("id", "name", "role", "externalId", "email", "disabled")
    .first();

  if (!user) return res.status(404).send(error("用户不存在"));
  if ((user as any).disabled) return res.status(403).send(error("账号已停用"));

  res.status(200).send(success(user));
});
