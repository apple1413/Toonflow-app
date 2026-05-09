import jwt from "jsonwebtoken";
import { Socket } from "socket.io";
import u from "@/utils";
import { assertOwnsProject, assertOwnsScript } from "@/utils/ownership";

interface JwtPayload {
  id: number | string;
  name?: string;
}

/** 解析 socket.handshake.auth.token，校验签名并返回 userId（number）。
 *  失败返回 null（让调用方决定怎么断开）。
 */
export async function verifySocketToken(rawToken: unknown): Promise<number | null> {
  if (typeof rawToken !== "string" || !rawToken) return null;
  const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
  if (!setting) return null;
  const tokenKey = setting.value as string;
  const token = rawToken.replace("Bearer ", "");
  try {
    const decoded = jwt.verify(token, tokenKey) as JwtPayload;
    const id = typeof decoded.id === "number" ? decoded.id : Number(decoded.id);
    if (!Number.isFinite(id) || id <= 0 || !Number.isInteger(id)) return null;
    return id;
  } catch {
    return null;
  }
}

/** Agent 上下文校验：
 *  - 必须有 token（且签名合法）
 *  - 必须传 projectId，且归当前 user
 *  - 如果传 scriptId，也要归当前 user
 *  - isolationKey 必须以 `${projectId}:` 开头，防止客户端伪造别人的房间
 *
 *  返回 userId；失败返回 null（同时断开 socket，写日志）
 */
export async function authSocketAgentContext(
  socket: Socket,
  ctx: { projectId?: unknown; scriptId?: unknown; isolationKey?: unknown },
  logTag: string,
): Promise<number | null> {
  const userId = await verifySocketToken(socket.handshake.auth.token);
  if (userId == null) {
    console.log(`[${logTag}] socket 拒绝：token 无效`);
    socket.disconnect();
    return null;
  }
  const projectId = Number(ctx.projectId);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    console.log(`[${logTag}] socket 拒绝：缺少合法 projectId`);
    socket.disconnect();
    return null;
  }
  try {
    await assertOwnsProject(userId, projectId);
    if (ctx.scriptId != null && ctx.scriptId !== "") {
      await assertOwnsScript(userId, ctx.scriptId);
    }
  } catch (e: any) {
    console.log(`[${logTag}] socket 拒绝：项目/剧本归属校验失败`, e?.message);
    socket.disconnect();
    return null;
  }
  // isolationKey 校验：客户端构造为 `${projectId}:${agentType}[:${episodesId}]`
  const isolationKey = ctx.isolationKey;
  if (typeof isolationKey !== "string" || !isolationKey.startsWith(`${projectId}:`)) {
    console.log(`[${logTag}] socket 拒绝：isolationKey 与 projectId 不匹配`, isolationKey);
    socket.disconnect();
    return null;
  }
  return userId;
}
