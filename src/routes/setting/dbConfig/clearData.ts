import express from "express";
import { success, error } from "@/lib/responseFormat";
import { db } from "@/utils/db";
import initDB from "@/lib/initDB";
import { assertAdmin } from "@/utils/ownership";

const router = express.Router();

// 整库清空 + 重建。仅 admin。实现用 SQLite 专属语法（sqlite_master/PRAGMA），
// 即便误调到 PG 也会自然 SQL error，多一道保险
export default router.get("/", async (req, res) => {
  try {
    assertAdmin(req);
    // 获取所有表名
    const tables: { name: string }[] = await db.raw(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%'`,
    );

    // 禁用外键约束，逐一删除所有表
    await db.raw("PRAGMA foreign_keys = OFF");
    for (const table of tables) {
      await db.schema.dropTableIfExists(table.name);
    }
    await db.raw("PRAGMA foreign_keys = ON");

    // 重新初始化数据库
    await initDB(db as any);

    res.status(200).send(success("数据库已清空并重新初始化"));
  } catch (err: any) {
    res.status(500).send(error(err?.message || "清除失败"));
  }
});
