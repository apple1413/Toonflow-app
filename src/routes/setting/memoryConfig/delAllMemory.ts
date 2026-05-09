import express from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { userIdOf } from "@/utils/ownership";
const router = express.Router();

// 之前是无差别 del()，会清空所有用户的记忆。改为只删当前用户的。
export default router.post("/", async (req, res) => {
  const userId = userIdOf(req);
  await u.db("memories").where({ userId }).del();
  res.status(200).send(success(true));
});
