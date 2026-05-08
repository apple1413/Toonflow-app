// 多租户权限校验：把"这条数据归属哪个用户"的判定集中到此处
// 原则：所有写/删/读操作前先调用 assertOwns* 验证资源属于当前 req.user.id
import db from "@/utils/db";
import type { Request } from "express";

export class ForbiddenError extends Error {
  status = 403;
  constructor(msg = "无权访问") {
    super(msg);
    this.name = "ForbiddenError";
  }
}

/** 从 express req 取当前登录 userId（JWT 中间件已注入 req.user） */
export function userIdOf(req: Request): number {
  const u = (req as any).user;
  const id = u?.id;
  if (typeof id !== "number" || !Number.isFinite(id)) {
    throw new ForbiddenError("未登录或 token 无效");
  }
  return id;
}

const toId = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new ForbiddenError("ID 非法");
  return n;
};

/** 校验 projectId 归当前 user。这是所有归属判断的根。 */
export async function assertOwnsProject(userId: number, projectId: unknown): Promise<void> {
  const pid = toId(projectId);
  const row = await db("o_project").where({ id: pid }).select("userId").first();
  if (!row || row.userId !== userId) throw new ForbiddenError("无权访问该项目");
}

/** 通过 projectId 列表批量校验（避免 N+1） */
export async function assertOwnsProjects(userId: number, projectIds: unknown[]): Promise<void> {
  const ids = [...new Set(projectIds.filter((v) => v != null).map(toId))];
  if (ids.length === 0) return;
  const rows = await db("o_project").whereIn("id", ids).select("id", "userId");
  if (rows.length !== ids.length) throw new ForbiddenError("部分项目不存在");
  for (const r of rows) {
    if (r.userId !== userId) throw new ForbiddenError("无权访问部分项目");
  }
}

/** 子资源（带 projectId 列）的通用归属校验 */
async function assertOwnsByChildId(
  table: string,
  userId: number,
  id: unknown,
  notFoundMsg: string,
): Promise<void> {
  const cid = toId(id);
  const row = await db(table as any).where({ id: cid }).select("projectId").first();
  if (!row) throw new ForbiddenError(notFoundMsg);
  if (!row.projectId) throw new ForbiddenError(notFoundMsg + "：projectId 缺失");
  await assertOwnsProject(userId, row.projectId);
}

export const assertOwnsScript = (uid: number, id: unknown) => assertOwnsByChildId("o_script", uid, id, "剧本不存在");
export const assertOwnsNovel = (uid: number, id: unknown) => assertOwnsByChildId("o_novel", uid, id, "小说不存在");
export const assertOwnsAsset = (uid: number, id: unknown) => assertOwnsByChildId("o_assets", uid, id, "资产不存在");
export const assertOwnsStoryboard = (uid: number, id: unknown) =>
  assertOwnsByChildId("o_storyboard", uid, id, "分镜不存在");
export const assertOwnsVideo = (uid: number, id: unknown) => assertOwnsByChildId("o_video", uid, id, "视频不存在");
export const assertOwnsVideoTrack = (uid: number, id: unknown) =>
  assertOwnsByChildId("o_videoTrack", uid, id, "视频轨不存在");
export const assertOwnsTask = (uid: number, id: unknown) => assertOwnsByChildId("o_tasks", uid, id, "任务不存在");

/** 批量校验同表多 id，全部归当前 user */
async function assertOwnsBatch(
  table: string,
  userId: number,
  ids: unknown[],
  notFoundMsg: string,
): Promise<void> {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const cids = [...new Set(ids.filter((v) => v != null).map(toId))];
  const rows = await db(table as any).whereIn("id", cids).select("id", "projectId");
  if (rows.length !== cids.length) throw new ForbiddenError(notFoundMsg);
  await assertOwnsProjects(userId, rows.map((r: any) => r.projectId));
}

export const assertOwnsScripts = (uid: number, ids: unknown[]) =>
  assertOwnsBatch("o_script", uid, ids, "部分剧本不存在");
export const assertOwnsNovels = (uid: number, ids: unknown[]) =>
  assertOwnsBatch("o_novel", uid, ids, "部分小说不存在");
export const assertOwnsAssets = (uid: number, ids: unknown[]) =>
  assertOwnsBatch("o_assets", uid, ids, "部分资产不存在");
export const assertOwnsStoryboards = (uid: number, ids: unknown[]) =>
  assertOwnsBatch("o_storyboard", uid, ids, "部分分镜不存在");

/** 图片 id → 通过 o_image.assetsId 链到 asset → project */
export async function assertOwnsImage(userId: number, imageId: unknown): Promise<void> {
  const iid = toId(imageId);
  const row = await db("o_image").where({ id: iid }).select("assetsId").first();
  if (!row) throw new ForbiddenError("图片不存在");
  if (row.assetsId) return assertOwnsAsset(userId, row.assetsId);
  throw new ForbiddenError("图片归属不明");
}

/** 列出当前 user 的所有 projectId（用于 list 类查询直接 whereIn） */
export async function listOwnedProjectIds(userId: number): Promise<number[]> {
  const rows = await db("o_project").where({ userId }).select("id");
  return rows.map((r: any) => Number(r.id));
}
