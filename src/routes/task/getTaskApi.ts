import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
import { userIdOf, assertOwnsProject, listOwnedProjectIds } from "@/utils/ownership";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    state: z.string().optional().nullable(),
    taskClass: z.string().optional().nullable(),
    projectId: z.number().optional().nullable(),
    page: z.number(),
    limit: z.number(),
  }),
  async (req, res) => {
    const { taskClass, state, projectId, page = 1, limit = 10 }: any = req.body;
    const userId = userIdOf(req);
    // 限定查询只能落在当前用户名下的项目
    let scopedProjectIds: number[];
    if (projectId) {
      await assertOwnsProject(userId, projectId);
      scopedProjectIds = [projectId];
    } else {
      scopedProjectIds = await listOwnedProjectIds(userId);
      if (scopedProjectIds.length === 0) return res.status(200).send(success({ data: [], total: 0 }));
    }
    const offset = (page - 1) * limit;
    const data = await u
      .db("o_tasks")
      .leftJoin("o_project", "o_project.id", "o_tasks.projectId")
      .whereIn("o_tasks.projectId", scopedProjectIds)
      .andWhere((qb) => {
        if (taskClass) {
          qb.andWhere("o_tasks.taskClass", taskClass);
        }
        if (state) {
          qb.andWhere("o_tasks.state", state);
        }
      })
      .select("o_tasks.*", "o_project.* ")
      .offset(offset)
      .limit(limit)
      .orderBy("o_tasks.id", "desc");
    const totalQuery = (await u
      .db("o_tasks")
      .whereIn("projectId", scopedProjectIds)
      .andWhere((qb) => {
        if (taskClass) {
          qb.andWhere("taskClass", taskClass);
        }
        if (state) {
          qb.andWhere("state", state);
        }
      })
      .count("* as total")
      .first()) as any;
    res.status(200).send(success({ data, total: totalQuery?.total }));
  },
);
