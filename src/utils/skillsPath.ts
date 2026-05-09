import p from "path";
import isPathInside from "is-path-inside";
import u from "@/utils";

/**
 * 技能文件的归属判定工具。
 *
 * 目录约定：
 *   data/skills/                    — 系统级技能（agent 代码硬引用，所有用户共享，只读给普通用户）
 *   data/skills/users/<userId>/     — 用户私有技能（用户自己可读写）
 *
 * 路径形式（前端传入的 path 是相对 data/skills/ 的相对路径）：
 *   "script_agent_decision.md"      → 系统技能
 *   "art_skills/foo/bar.md"         → 系统技能
 *   "users/123/my_skill.md"         → 用户 123 的私有技能
 */
export const USERS_PREFIX = "users";

export interface SkillPathInfo {
  /** 解析后的绝对路径 */
  abs: string;
  /** 是否是系统级（共享）技能 */
  isSystem: boolean;
  /** 如果是用户私有技能，所属 userId；否则 null */
  ownerId: number | null;
}

/** 解析前端传来的相对 path，校验合法性，返回归属信息。
 *  非法路径（穿越 skills 根、奇怪格式）抛错。
 */
export function classifySkillPath(relPath: string): SkillPathInfo {
  if (typeof relPath !== "string" || !relPath.trim()) {
    throw new Error("无效的路径：path 不能为空");
  }
  const skillsRoot = u.getPath(["skills"]);
  const abs = p.join(skillsRoot, relPath);
  if (!isPathInside(abs, skillsRoot) && p.resolve(abs) !== p.resolve(skillsRoot)) {
    throw new Error("无效的路径：超出 skills 根目录");
  }

  // 用 forward slash 规范化判定前缀
  const norm = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const segs = norm.split("/").filter(Boolean);
  if (segs[0] === USERS_PREFIX) {
    if (segs.length < 3) {
      // users/ 后必须至少有 <userId>/<file>
      throw new Error("无效的路径：users/ 下缺少用户 id 或文件");
    }
    const ownerId = Number(segs[1]);
    if (!Number.isFinite(ownerId) || ownerId <= 0 || !Number.isInteger(ownerId)) {
      throw new Error("无效的路径：users/ 后的 userId 非法");
    }
    return { abs, isSystem: false, ownerId };
  }
  return { abs, isSystem: true, ownerId: null };
}

/** 当前用户在 skills 目录下的私有空间（绝对路径） */
export function userSkillsDir(userId: number): string {
  return u.getPath(["skills", USERS_PREFIX, String(userId)]);
}

/** 当前用户私有文件的相对路径前缀（用于 fast-glob cwd 拼接） */
export function userSkillsRelPrefix(userId: number): string {
  return `${USERS_PREFIX}/${userId}`;
}
