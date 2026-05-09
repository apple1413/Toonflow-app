import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { assertAdminAsync } from "@/utils/ownership";
const router = express.Router();

// admin 列出所有用户。不返回 password 字段。
export default router.post("/", async (req, res) => {
  await assertAdminAsync(req);
  const rows = await u
    .db("o_user")
    .select("id", "name", "role", "disabled", "externalId", "email", "createTime")
    .orderBy("id", "asc");
  res.status(200).send(success(rows));
});
