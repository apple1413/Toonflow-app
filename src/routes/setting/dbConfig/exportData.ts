import express from "express";
import { success, error } from "@/lib/responseFormat";
import { db } from "@/utils/db";
import { assertAdmin } from "@/utils/ownership";

const router = express.Router();

// 导出整库数据。原本是给单机 Electron 用户备份的；SaaS 模式下导出全表数据相当于
// 拿到所有用户的全部内容，必须锁 admin。
export default router.get("/", async (req, res) => {
  try {
    assertAdmin(req);
    const tables: { name: string }[] = await db.raw(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knex_%'`,
    );

    const data: Record<string, any[]> = {};
    for (const table of tables) {
      data[table.name] = await db.raw(`SELECT * FROM "${table.name}"`);
    }

    const exportData = {
      exportTime: Date.now(),
      tables: data,
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=toonflow-backup-${Date.now()}.json`);
    res.status(200).send(JSON.stringify(exportData, null, 2));
  } catch (err: any) {
    res.status(500).send(error(err?.message || "导出失败"));
  }
});
