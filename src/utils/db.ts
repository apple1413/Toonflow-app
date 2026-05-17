import knex, { Knex } from "knex";
import initDB from "@/lib/initDB";
import type { DB } from "@/types/database";
import fixDB from "@/lib/fixDB";

type TableName = keyof DB & string;
type RowType<TName extends TableName> = DB[TName];

// 多租户模式：所有部署（包括桌面端）都直连 Supabase。本地 SQLite 分支已废弃，
// 历史本地数据保留在 data/db2.sqlite 文件里作为离线备份，需要捞旧数据时手动用 sqlite3 CLI 开。
if (!process.env.DATABASE_URL) {
  throw new Error(
    "[db] 缺少 DATABASE_URL。Toonflow 已切到 Supabase 多租户模式，必须在 .env 配置 DATABASE_URL（与 shipany-template-two 同库）。",
  );
}

// Postgres 默认把 BIGINT (OID 20) 当 string 返回防精度丢失，
// 但 Toonflow 的 id 都是 Date.now() 量级（~1.7e12，远小于 2^53），
// 解析回 number 让上层（JWT 载荷、ownership 校验、knex.where({ id })）行为与原 SQLite 一致
const pg = require("pg");
pg.types.setTypeParser(20, (v: string) => (v == null ? null : parseInt(v, 10)));

console.log("数据库: Postgres (Supabase) schema=toonflow");
const db: Knex = knex({
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

let initPromise: Promise<void> | null = null;
export function initDb(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await initDB(db);
      await fixDB(db);
      // 老的 initKnexType（从 SQLite schema 反推 TypeScript 类型）已经移除——
      // types/database.d.ts 现在由人工维护，或者用 @rmp135/sql-ts CLI 一次性按需运行
      // （src/types/database.d.ts 是当前权威）。
    })();
  }
  return initPromise;
}

const dbClient = Object.assign(<TName extends TableName>(table: TName) => db<RowType<TName>, RowType<TName>[]>(table), db);
dbClient.schema = db.schema;
export default dbClient;

export { db };
