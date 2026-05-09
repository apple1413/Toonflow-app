import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsProject, assertOwnsScript } from "@/utils/ownership";
import { insertReturnId } from "@/utils/insertReturnId";
const router = express.Router();
interface Storyboard {
  id: number;
  track: string;
  src: string | null;
  associateAssetsIds: number[];
  duration: number;
  state: string;
}
export default router.post(
  "/",
  validateFields({
    prompt: z.string(),
    duration: z.number(),
    state: z.string(),
    videoDesc: z.string(),
    shouldGenerateImage: z.number(),
    src: z.string().nullable(),
    scriptId: z.number(),
    projectId: z.number(),
  }),
  async (req, res) => {
    const { prompt, duration, state, src, scriptId, projectId, videoDesc, shouldGenerateImage } = req.body;
    const userId = userIdOf(req);
    await assertOwnsProject(userId, projectId);
    await assertOwnsScript(userId, scriptId);
    const trackId = Date.now()
    await u.db("o_videoTrack").insert({
      id: trackId,
      scriptId: scriptId,
      projectId,
    });
    const id = await insertReturnId("o_storyboard", {
      prompt,
      duration,
      state,
      filePath: u.replaceUrl(src),
      trackId,
      videoDesc,
      shouldGenerateImage: src ? 1 : 0,
      scriptId: scriptId,
      projectId: projectId,
    });
    return res.status(200).send(success({ id }));
  },
);
