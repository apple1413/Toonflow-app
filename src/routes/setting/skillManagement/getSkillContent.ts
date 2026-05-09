import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
import * as fs from "fs";
import { userIdOf, isAdmin } from "@/utils/ownership";
import { classifySkillPath } from "@/utils/skillsPath";

const router = express.Router();

// 读规则：
// - 系统级技能（不在 users/ 下）：所有登录用户可读（agent 默认提示词，全局共享）
// - 用户私有技能（users/<ownerId>/...）：仅 ownerId 本人或 admin 可读
export default router.post(
  "/",
  validateFields({
    path: z.string(),
  }),
  async (req, res) => {
    const { path } = req.body;
    let info;
    try {
      info = classifySkillPath(path);
    } catch (e: any) {
      return res.status(400).send(error(e?.message || "无效的路径"));
    }
    const userId = userIdOf(req);
    if (!info.isSystem && info.ownerId !== userId && !isAdmin(req)) {
      return res.status(403).send(error("无权访问该用户的私有技能"));
    }
    const raw = await fs.promises.readFile(info.abs, "utf-8");
    res.status(200).send(success(raw));
  },
);
