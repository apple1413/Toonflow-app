import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { userIdOf, listOwnedProjectIds } from "@/utils/ownership";
const router = express.Router();

// 任务分类下拉，仅基于当前用户名下项目的任务派生
export default router.post("/", async (req, res) => {
  const userId = userIdOf(req);
  const projectIds = await listOwnedProjectIds(userId);
  if (projectIds.length === 0) return res.status(200).send(success([]));
  const list = await u.db("o_tasks").whereIn("projectId", projectIds).groupBy("taskClass").select("taskClass");
  const data = list.filter((item) => item.taskClass);
  res.status(200).send(success(data));
});
