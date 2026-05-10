import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { userIdOf } from "@/utils/ownership";
import { getBalance } from "@/utils/credits";
const router = express.Router();

// 当前用户的积分余额（透传主项目）。
// 返回 -1 表示未配置 CREDITS_API_URL（dev / Electron 模式），前端可隐藏积分显示
export default router.post("/", async (req, res) => {
  const userId = userIdOf(req);
  const user = await u.db("o_user").where({ id: userId }).select("externalId").first();
  if (!user?.externalId) return res.status(200).send(success({ remaining: -1 }));
  const remaining = await getBalance(user.externalId as string);
  res.status(200).send(success({ remaining }));
});
