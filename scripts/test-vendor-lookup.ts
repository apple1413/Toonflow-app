// 直接复刻 getModelList 逻辑验证：DB 读 NULL 全局 + vendor 文件 models 合并
import knex from "knex";
import fs from "fs";
import path from "path";
import { transform } from "sucrase";

(async () => {
  const k = knex({
    client: "pg",
    connection: { connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false }, keepAlive: true } as any,
    searchPath: ["toonflow", "public"],
    pool: { min: 0, max: 3, idleTimeoutMillis: 30000 },
  });
  try {
    const id = "volcengine";
    const row = await k("o_vendorConfig").where("id", id).whereNull("userId").select("models").first();
    if (!row) { console.error("NULL 全局行不存在"); process.exit(1); }
    const tsCode = fs.readFileSync(path.resolve("data/vendor", `${id}.ts`), "utf8");
    const jsCode = transform(tsCode, { transforms: ["typescript"] }).code;
    const sandbox: any = { exports: {}, console };
    new Function("exports", "console", jsCode)(sandbox.exports, console);
    const vendorObj = sandbox.exports.vendor;
    const dbModels = (() => { try { return JSON.parse(row.models ?? "[]"); } catch { return []; } })();
    const combined = [...vendorObj.models, ...dbModels];
    const map = new Map<string, any>();
    for (const m of combined) map.set(m.modelName, m);
    const list = [...map.values()];
    console.log("volcengine 合并模型总数:", list.length);
    const target = list.find((m: any) => m.modelName === "doubao-seed-2-0-lite-260215");
    console.log("查 doubao-seed-2-0-lite-260215:", target ? "✓ " + target.name : "✗ 未找到");
  } finally {
    await k.destroy();
  }
})();
