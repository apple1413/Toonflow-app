import { readFile, writeFile } from "fs/promises";
import getPath, { isEletron } from "@/utils/getPath";
import fs from "fs";
import path from "path";
import knex, { Knex } from "knex";
import initDB from "@/lib/initDB";
import type { DB } from "@/types/database";
import crypto from "crypto";
import fixDB from "@/lib/fixDB";

type TableName = keyof DB & string;
type RowType<TName extends TableName> = DB[TName];

// Electron 桌面端永远使用本地 SQLite；只有非 Electron（SaaS server）才看 DATABASE_URL
const useCloudDb = !isEletron() && !!process.env.DATABASE_URL;

let db: Knex;
if (useCloudDb) {
  // Postgres 默认把 BIGINT (OID 20) 当 string 返回防精度丢失，
  // 但 Toonflow 的 id 都是 Date.now() 量级（~1.7e12，远小于 2^53），
  // 解析回 number 让上层（JWT 载荷、ownership 校验、knex.where({ id })）行为与 SQLite 一致
  const pg = require("pg");
  pg.types.setTypeParser(20, (v: string) => (v == null ? null : parseInt(v, 10)));

  console.log("数据库: Postgres (DATABASE_URL) schema=toonflow");
  db = knex({
    client: "pg",
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Supabase 强制 SSL，证书链由托管侧管理
      // 让 pg socket 开 TCP keep-alive，闲置时定期发心跳，避开 Supabase pooler 静默回收闲连
      // 这是根治 "Connection terminated unexpectedly" 间歇报错的方法
      keepAlive: true,
    },
    // 把 Toonflow 表隔离到独立 schema，避免与库里其他产品表名冲突
    // 第二项 public 用于读取共享对象（如 extension）；写入永远落到第一项 toonflow
    searchPath: ["toonflow", "public"],
    pool: {
      min: 0,
      max: 10,
      // 闲置 30s 主动销毁连接，让下次请求建新的，避开 pooler 端可能的提前 close
      idleTimeoutMillis: 30_000,
    },
    acquireConnectionTimeout: 10_000,
  });
} else {
  const dbPath = getPath("db2.sqlite");
  console.log("数据库目录:", dbPath);
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, "");
  }
  db = knex({
    client: "better-sqlite3",
    connection: { filename: dbPath },
    useNullAsDefault: true,
  });
}

let initPromise: Promise<void> | null = null;
export function initDb(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await initDB(db);
      await fixDB(db);
      // 类型同步只在 SQLite 路径跑，避免 dev 机器在 cloud DB 下覆写为 pg 衍生类型
      if (process.env.NODE_ENV == "dev" && !useCloudDb) await initKnexType(db);
    })();
  }
  return initPromise;
}

const dbClient = Object.assign(<TName extends TableName>(table: TName) => db<RowType<TName>, RowType<TName>[]>(table), db);
dbClient.schema = db.schema;
export default dbClient;

export { db };

async function initKnexType(knexDb: any) {
  const { Client } = await import("@rmp135/sql-ts");
  const outFile = "src/types/database.d.ts";
  const dbClient = Client.fromConfig({
    interfaceNameFormat: "${table}",
    typeMap: {
      number: ["bigint"],
      string: ["text", "varchar", "char"],
    },
  }).fetchDatabase(knexDb);
  const declarations = await dbClient.toTypescript();
  const dbObject = await dbClient.toObject();
  const customHeader = `//该文件由脚本自动生成，请勿手动修改`;
  // 清除上次的注释头
  let declBody = declarations.replace(/^\/\*[\s\S]*?\*\/\s*/, "");
  declBody = declBody.replace(/(\n\s*)\/\*([^*][\s\S]*?)\*\//g, "$1/**$2*/");
  const tableInterfaces = dbObject.schemas.flatMap((schema) => schema.tables.map((table) => table.interfaceName));
  const aggregateTypes = `
export interface DB {
${tableInterfaces.map((name) => `  ${JSON.stringify(name)}: ${name};`).join("\n")}
}
`;
  // 哈希仅基于结构化信息，header和空格不算
  const hashSource = JSON.stringify({
    tableInterfaces,
    declBody,
  });
  const hash = crypto.createHash("md5").update(hashSource).digest("hex");
  // 文件内容
  const content = `// @db-hash ${hash}\n${customHeader}\n\n` + declBody + aggregateTypes;
  let needWrite = true;
  try {
    const current = await readFile(outFile, "utf8");
    // 文件头已存在相同 hash，不需要写
    const match = current.match(/^\/\/\s*@db-hash\s*([a-zA-Z0-9]+)\n/);
    const currentHash = match ? match[1] : null;
    if (currentHash === hash) {
      needWrite = false;
    }
  } catch (err) {
    needWrite = true;
  }
  if (needWrite) await writeFile(outFile, content, "utf8");
}
