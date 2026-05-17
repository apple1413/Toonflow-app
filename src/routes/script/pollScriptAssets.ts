import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf, assertOwnsScripts } from "@/utils/ownership";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    ids: z.array(z.number()),
  }),
  async (req, res) => {
    const { ids } = req.body;
    await assertOwnsScripts(userIdOf(req), ids);
    // 原 `whereNot("extractState", "生成中")` 是老 SQLite 时代留下的字符串比较——SQLite 类型松，
    // 整型列跟中文字符串比也不报错，老逻辑变成"恒真"，所以一直没被发现。
    // PG 上 extractState 是 bigInteger，'生成中' 无法转 bigint，整条 query 报 22P02 invalid input syntax。
    // 修复：用 int 枚举显式排除进行中状态（0=正在提取，2=等待提取），返回的就是已 settle 的剧本（1 成功 / -1 失败），
    // 调用方据此判断"轮询可以收尾"。
    const data = await u
      .db("o_script")
      .whereIn("id", ids)
      .whereNotIn("extractState", [0, 2])
      .select("id", "extractState", "errorReason");
    res.status(200).send(success(data));
  },
);
