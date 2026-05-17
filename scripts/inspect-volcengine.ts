import knex from "knex";
(async () => {
  const k = knex({
    client: "pg",
    connection: { connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false }, keepAlive: true } as any,
    searchPath: ["toonflow", "public"],
    pool: { min: 0, max: 3, idleTimeoutMillis: 30000 },
  });
  try {
    const r = await k("o_vendorConfig").where("id", "volcengine").select("userId", "models", "enable");
    for (const row of r) {
      console.log("userId=", row.userId, "enable=", row.enable, "models 长度=", row.models?.length, "is null?", row.models == null);
      console.log("  内容:", JSON.stringify(row.models)?.slice(0, 100));
    }
  } finally {
    await k.destroy();
  }
})();
