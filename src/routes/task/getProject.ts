import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { userIdOf } from "@/utils/ownership";
const router = express.Router();

// 任务页用的项目下拉列表，只列当前用户名下项目
// 原 groupBy("name") 在 PG 严格模式下会报"id 必须出现在 GROUP BY"错误，已改成按 (id, name) 分组
export default router.post("/", async (req, res) => {
  const userId = userIdOf(req);
  const list = await u.db("o_project").where({ userId }).groupBy("id", "name").select("id", "name");
  const data = list.filter((item) => item.name);
  res.status(200).send(success(data));
});
