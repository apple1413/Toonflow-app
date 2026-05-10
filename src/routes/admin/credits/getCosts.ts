import express from "express";
import { success } from "@/lib/responseFormat";
import { assertAdminAsync } from "@/utils/ownership";
import { listCosts } from "@/utils/credits";
const router = express.Router();

// admin 列出所有扣费场景的当前价格（含默认值 + DB 覆盖）
export default router.post("/", async (req, res) => {
  await assertAdminAsync(req);
  const list = await listCosts();
  res.status(200).send(success(list));
});
