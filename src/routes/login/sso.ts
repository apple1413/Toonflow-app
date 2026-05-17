import express from "express";
import crypto from "crypto";
import u from "@/utils";
import { setToken } from "./login";
import { getTokenKey } from "@/utils/tokenKey";

const router = express.Router();

// uid 必须是 UUID（v1~v5），防止 ?uid=1 这类可枚举值冒充用户
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const pickStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

// HMAC 签名校验：外部主站调 SSO 时传 uid + ts + sig（hex(hmac-sha256(secret, `${uid}|${ts}`))）
// 仅当 SSO_SHARED_SECRET env 已配置时启用强校验；否则走旧"相信前端 uid"行为并 warn
const SSO_TS_TOLERANCE_SEC = 5 * 60; // 5 分钟时间窗
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}
function verifySsoSignature(uid: string, ts: string, sig: string, secret: string): boolean {
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  const skewSec = Math.abs(Date.now() / 1000 - tsNum);
  if (skewSec > SSO_TS_TOLERANCE_SEC) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${uid}|${ts}`).digest("hex");
  return timingSafeEqualHex(expected, sig.toLowerCase());
}

// 仅允许同源相对路径，拒绝 //host、/\host、协议绝对地址等
const sanitizeRedirect = (raw: string | undefined): string => {
  if (!raw) return "/drama-factory/";
  if (raw[0] !== "/") return "/drama-factory/";
  if (raw.length > 1 && (raw[1] === "/" || raw[1] === "\\")) return "/drama-factory/";
  return raw;
};

// 嵌入 <script> 标签时的安全转义：</script> 与 U+2028/U+2029（行分隔符）
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const jsonForScript = (v: unknown): string => {
  return JSON.stringify(v)
    .replace(/</g, "\\u003C")
    .split(LS).join("\\u2028")
    .split(PS).join("\\u2029");
};

// SSO 入站：外部主站把当前用户 UUID 直接拼到链接里发起跳转
// GET /api/login/sso?uid=<uuid>&ts=<unix_seconds>&sig=<hmac-hex>&redirect=
//
// 强校验：env SSO_SHARED_SECRET 设置后，必须带 ts + sig（hmac-sha256(secret, `${uid}|${ts}`)），
// 时间窗 5 分钟。
// 兼容模式：env 未设置时走旧"相信前端 uid"流程，但每次请求会 warn 一次（生产请配 env）。
export default router.get("/", async (req, res) => {
  const q = req.query as Record<string, unknown>;
  const uid = pickStr(q.uid);
  const ts = pickStr(q.ts);
  const sig = pickStr(q.sig);
  const redirect = sanitizeRedirect(pickStr(q.redirect));

  if (!uid || !UUID_RE.test(uid)) {
    return res.status(400).type("text/plain").send("uid 非法");
  }

  const sharedSecret = process.env.SSO_SHARED_SECRET;
  if (sharedSecret && sharedSecret.trim()) {
    if (!ts || !sig) {
      return res.status(400).type("text/plain").send("缺少 ts/sig 签名参数");
    }
    if (!verifySsoSignature(uid, ts, sig, sharedSecret)) {
      return res.status(401).type("text/plain").send("SSO 签名无效或已过期");
    }
  } else {
    console.warn("[SSO] SSO_SHARED_SECRET 未配置——任何持有 uid 的请求都能登录该用户。生产环境请务必配置该 env");
  }

  // 找/建本地用户（兼容并发：插入冲突时回查同 externalId）
  let user = await u.db("o_user").where("externalId", uid).first();
  if (!user) {
    const id = Date.now();
    try {
      await u.db("o_user").insert({
        id,
        externalId: uid,
        name: `user_${uid.slice(0, 8)}`,
        password: "",
        role: "user",
        createTime: Date.now(),
      });
    } catch (e) {
      user = await u.db("o_user").where("externalId", uid).first();
      if (!user) throw e;
    }
    if (!user) {
      user = await u.db("o_user").where("id", id).first();
    }
    if (!user) {
      return res.status(500).type("text/plain").send("用户创建失败");
    }
  }
  if ((user as any).disabled) {
    return res.status(403).type("text/plain").send("账号已停用，请联系管理员");
  }

  // 签 Toonflow 自身的 JWT（与现有 /api/login/login 一致）
  let tokenKey: string;
  try {
    tokenKey = await getTokenKey();
  } catch {
    return res.status(500).type("text/plain").send("服务器秘钥未配置");
  }
  const token = "Bearer " + setToken({ id: user.id, name: user.name }, "180Days", tokenKey);

  // 返回小 HTML：把 token 写入 localStorage 后跳首页（前端读 localStorage.token）
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Signing in…</title></head>
<body><script>
(function(){
  try { localStorage.setItem("token", ${jsonForScript(token)}); } catch (e) {}
  location.replace(${jsonForScript(redirect)});
})();
</script></body></html>`;
  res.status(200).type("text/html").send(html);
});
