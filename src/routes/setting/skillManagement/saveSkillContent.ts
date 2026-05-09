import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
import p from "path";
import * as fs from "fs";
import { userIdOf, isAdmin } from "@/utils/ownership";
import { classifySkillPath } from "@/utils/skillsPath";

const router = express.Router();

// 写规则（更严格）：
// - 系统级技能（agent 共享提示词）：仅 admin 可改
// - 用户私有技能：仅 ownerId 本人可改；admin 也可改任何人的（运维兜底）
// - 用户私有技能允许"新建"——上层路径若不存在自动 mkdir -p；系统技能仍要求文件已存在
export default router.post(
  "/",
  validateFields({
    path: z.string(),
    content: z.string(),
  }),
  async (req, res) => {
    const { path, content } = req.body;
    let info;
    try {
      info = classifySkillPath(path);
    } catch (e: any) {
      return res.status(400).send(error(e?.message || "无效的路径"));
    }
    const userId = userIdOf(req);
    const admin = isAdmin(req);

    if (info.isSystem) {
      if (!admin) return res.status(403).send(error("仅管理员可修改系统技能"));
      if (!fs.existsSync(info.abs)) {
        return res.status(400).send(error("文件不存在"));
      }
    } else {
      // 用户私有：本人 or admin
      if (info.ownerId !== userId && !admin) {
        return res.status(403).send(error("无权修改他人的私有技能"));
      }
      // 私有技能允许新建：保证父目录存在
      await fs.promises.mkdir(p.dirname(info.abs), { recursive: true });
    }

    await fs.promises.writeFile(info.abs, content, "utf-8");
    res.status(200).send(success(""));
  },
);
