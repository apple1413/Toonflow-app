import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsProject, assertOwnsScript } from "@/utils/ownership";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    videoIds: z.array(z.number()),
  }),
  async (req, res) => {
    const { projectId, scriptId, videoIds } = req.body;
    const userId = userIdOf(req);
    await assertOwnsProject(userId, projectId);
    await assertOwnsScript(userId, scriptId);
    // 加上 projectId/scriptId 兜底过滤，即使 videoIds 包含他人项目的也查不到
    const videoList = await u
      .db("o_video")
      .whereIn("id", videoIds)
      .where({ projectId, scriptId })
      .whereIn("state", ["生成成功", "生成失败"])
      .select("id", "state", "errorReason", "filePath");
    res.status(200).send(
      success(
        await Promise.all(
          videoList.map(async (s) => ({
            ...s,
            src: s.filePath ? await u.oss.getFileUrl(s.filePath) : "",
          })),
        ),
      ),
    );
  },
);
