import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { userIdOf } from "@/utils/ownership";
const router = express.Router();

export default router.get("/", async (req, res) => {
  const userId = userIdOf(req);
  // 不返回 password 字段，避免敏感信息回显给前端
  const data = await u.db("o_user")
    .select("id", "name", "externalId", "email", "createTime")
    .where({ id: userId })
    .first();
  res.status(200).send(success(data));
});
