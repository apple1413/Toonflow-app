import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { userIdOf } from "@/utils/ownership";
const router = express.Router();

// 获取当前用户的项目列表
export default router.post("/", async (req, res) => {
  const userId = userIdOf(req);
  const data = await u.db("o_project").where({ userId }).select("*");
  res.status(200).send(success(data));
});
