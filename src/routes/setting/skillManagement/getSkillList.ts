import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import fg from "fast-glob";
import u from "@/utils";
import { userIdOf, isAdmin } from "@/utils/ownership";
import { USERS_PREFIX, userSkillsRelPrefix } from "@/utils/skillsPath";

const router = express.Router();

// 列表：所有用户能看到 系统级技能 + 自己的私有技能；admin 还能看到所有 users/<id>/* 内容
export default router.post("/", async (req, res) => {
  const userId = userIdOf(req);
  const skillsRoot = u.getPath(["skills"]).replace(/\\/g, "/");

  const allEntries = await fg("**/*.md", {
    cwd: skillsRoot,
    onlyFiles: true,
  });

  let entries: string[];
  if (isAdmin(req)) {
    entries = allEntries; // admin 看全部
  } else {
    const userPrefix = userSkillsRelPrefix(userId) + "/";
    entries = allEntries.filter((e) => {
      const norm = e.replace(/\\/g, "/");
      // 别人的 users/<otherId>/* 过滤掉
      if (norm.startsWith(`${USERS_PREFIX}/`)) {
        return norm.startsWith(userPrefix);
      }
      // 系统级技能（不在 users/ 下）所有人可见（只读，写时被 saveSkillContent 拦）
      return true;
    });
  }

  res.status(200).send(success(entries));
});
