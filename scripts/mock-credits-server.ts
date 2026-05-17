/**
 * 开发用 mock credits server（替代 mixvoice 主项目）。
 *
 * 端口：9888（避开 3000 / 8000 / 10588）
 * 返回固定余额，让本地 toonflow 的 sidebar 积分显示能跑起来调样式。
 *
 * 跑：
 *   tsx scripts/mock-credits-server.ts
 *
 * 改余额：
 *   MOCK_BALANCE=99999 tsx scripts/mock-credits-server.ts
 *
 * 协议（跟 mixvoice 真实端点一致，见 CREDITS_INTEGRATION.md）：
 *   GET  /balance?user_uuid=xxx           → { remaining: <number> }
 *   POST /charge  { user_uuid, amount, … } → { ok: true, remaining: <number> }
 */

import http from "node:http";

const PORT = Number(process.env.MOCK_CREDITS_PORT) || 9888;
let balance = Number(process.env.MOCK_BALANCE) || 12345;

const server = http.createServer(async (req, res) => {
  const url = req.url || "";
  const auth = req.headers.authorization || "";
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // mock auth: 接受任意 Bearer token，未带也允许（方便调试）
  void auth;

  if (req.method === "GET" && url.startsWith("/balance")) {
    console.log(`[mock] GET ${url}  → remaining=${balance}`);
    res.statusCode = 200;
    res.end(JSON.stringify({ remaining: balance }));
    return;
  }

  if (req.method === "POST" && url.startsWith("/charge")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    let payload: any = {};
    try { payload = JSON.parse(body); } catch {}
    const amount = Number(payload?.amount) || 0;
    if (amount <= 0) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "amount required" }));
      return;
    }
    if (balance < amount) {
      console.log(`[mock] POST /charge amount=${amount} → 402 余额不足`);
      res.statusCode = 402;
      res.end(JSON.stringify({ error: "余额不足", remaining: balance }));
      return;
    }
    balance -= amount;
    console.log(`[mock] POST /charge amount=${amount} → ok, remaining=${balance}`);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, remaining: balance }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found", url }));
});

server.listen(PORT, () => {
  console.log(`[mock] credits server on http://127.0.0.1:${PORT}`);
  console.log(`[mock] initial balance: ${balance}`);
  console.log(`[mock] endpoints:`);
  console.log(`  GET  http://127.0.0.1:${PORT}/balance?user_uuid=xxx`);
  console.log(`  POST http://127.0.0.1:${PORT}/charge   { amount, scene, task_id, user_uuid }`);
});
