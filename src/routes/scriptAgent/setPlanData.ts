import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsProject } from "@/utils/ownership";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    agentType: z.enum(["scriptAgent"]),
    data: z.object({
      storySkeleton: z.string(),
      adaptationStrategy: z.string(),
    }),
  }),
  async (req, res) => {
    const { projectId, agentType, data } = req.body;
    await assertOwnsProject(userIdOf(req), projectId);
    await u
      .db("o_agentWorkData")
      .where({ projectId: projectId, key: agentType })
      .update({
        data: JSON.stringify(data),
      });
    const script = data.script;

    // 之前是 check-then-insert + Promise.all 并发：前端 onXmlTag 短时间内连发 N 次
    // setPlanData，每个请求并发都看到"行不存在"就各自 INSERT，PG 上又没唯一约束 →
    // 同 name 出现 N 行重复（见 scripts/dedup-o-script.ts 修复脚本）。
    //
    // 改成 PG 的 INSERT ... ON CONFLICT (projectId, name) DO UPDATE：
    // - 数据库层串行化同 key 的并发请求，没法插出重复
    // - 配合 o_script (projectId, name) UNIQUE INDEX（见 initDB.ts indexPatches）
    if (script?.length) {
      await u
        .db("o_script")
        .insert(script.map((s: any) => ({ projectId, name: s.name, content: s.content })))
        .onConflict(["projectId", "name"])
        .merge(["content"]);
    }

    res.status(200).send(success());
  },
);
