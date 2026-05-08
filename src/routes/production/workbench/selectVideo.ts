import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsVideoTrack, assertOwnsVideo } from "@/utils/ownership";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    trackId: z.number(),
    videoId: z.number(),
  }),
  async (req, res) => {
    const { trackId, videoId } = req.body;
    const userId = userIdOf(req);
    await assertOwnsVideoTrack(userId, trackId);
    await assertOwnsVideo(userId, videoId);
    await u.db("o_videoTrack").where("id", trackId).update({
      videoId: videoId,
    });
    res.status(200).send(success({ message: "视频选择成功" }));
  },
);
