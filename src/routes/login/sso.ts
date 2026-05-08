import express from "express";
import u from "@/utils";
import { setToken } from "./login";

const router = express.Router();

// uid 必须是 UUID（v1~v5），防止 ?uid=1 这类可枚举值冒充用户
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const pickStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

// 仅允许同源相对路径，拒绝 //host、/\host、协议绝对地址等
const sanitizeRedirect = (raw: string | undefined): string => {
  if (!raw) return "/";
  if (raw[0] !== "/") return "/";
  if (raw.length > 1 && (raw[1] === "/" || raw[1] === "\\")) return "/";
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
// GET /api/login/sso?uid=<uuid>&redirect=
export default router.get("/", async (req, res) => {
  const q = req.query as Record<string, unknown>;
  const uid = pickStr(q.uid);
  const redirect = sanitizeRedirect(pickStr(q.redirect));

  if (!uid || !UUID_RE.test(uid)) {
    return res.status(400).type("text/plain").send("uid 非法");
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

  // 签 Toonflow 自身的 JWT（与现有 /api/login/login 一致）
  const tokenData = await u.db("o_setting").where("key", "tokenKey").first();
  if (!tokenData) {
    return res.status(500).type("text/plain").send("服务器秘钥未配置");
  }
  const token = "Bearer " + setToken({ id: user.id, name: user.name }, "180Days", tokenData.value as string);

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
