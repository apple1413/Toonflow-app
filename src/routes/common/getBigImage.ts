import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsProject } from "@/utils/ownership";
const router = express.Router();

// 获取生成图片
// 项目内的 OSS 路径形如 /{projectId}/<...>，需要校验 projectId 归当前用户。
// 公共/系统资源（如 /ending.mp4、/skills/...）路径不带数字前缀，放行。
export default router.post(
    "/",
    validateFields({
        url: z.string()
    }),
    async (req, res) => {
        const { url } = req.body
        const ossPath = u.replaceUrl(url)
        const m = ossPath.match(/^\/(\d+)(?:\/|$)/)
        if (m) {
            await assertOwnsProject(userIdOf(req), Number(m[1]))
        }
        const bigImageUrl = await u.oss.getFileUrl(ossPath)
        res.status(200).send(success(bigImageUrl));
    },
);
