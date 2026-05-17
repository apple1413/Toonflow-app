import { transform } from "sucrase";
import fs from "fs";
import path from "path";
import u from "@/utils";

export function writeCode(id: string | number, tsCode: string) {
  const rootDir = u.getPath("vendor")
  fs.mkdirSync(rootDir, { recursive: true })
  if (fs.existsSync(path.join(rootDir,  `${id}.ts`))) {
    fs.writeFileSync(path.join(rootDir,  `${id}.ts`), tsCode);
  }
  fs.writeFileSync(path.join(rootDir,  `${id}.ts`), tsCode);
}

export function getCode(id: string): string {
  const rootDir = u.getPath("vendor");
  const targetFile = path.join(rootDir, `${id}.ts`);
  if (!fs.existsSync(targetFile)) return "";
  return fs.readFileSync(targetFile, "utf-8");
}

/**
 * 取 vendor 全量模型列表（默认 + DB 自定义，按 modelName 去重）。
 * 不应用 o_modelEnable 过滤——纯模型清单。
 */
async function getRawModelList(id: string): Promise<any[]> {
  const row = await u.db("o_vendorConfig").where("id", id).select("models").first();
  // 只有 vendor 这行根本不存在时才返回空。
  // 之前的实现：`if (!row.models) return []` —— 把 row.models 为 NULL 也一并短路，
  // 结果连 data/vendor/<id>.ts 里写死的默认模型列表都读不到。
  // 这个字段在本地 SQLite 是 '[]'（非 NULL）所以一直没问题，迁到 Supabase 上新插入的
  // 行 models 字段是真 NULL，所有 vendor 的下拉列表瞬间空掉。
  if (!row) return [];
  const dbExtraModels: any[] = row.models ? JSON.parse(row.models) : [];
  const code = getCode(id);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  const defaultModels: any[] = vendorData?.vendor?.models ?? [];
  // vendor 文件默认 + DB 自定义，按 modelName 去重（DB 覆盖默认）
  const combined = [...JSON.parse(JSON.stringify(defaultModels)), ...dbExtraModels];
  const map = new Map<string, any>();
  for (const m of combined) {
    map.set(m.modelName, m);
  }
  return [...map.values()];
}

export async function getModelList(
  id: string,
  opts: { includeDisabled?: boolean } = {},
): Promise<Array<any>> {
  const models = await getRawModelList(id);
  if (opts.includeDisabled || models.length === 0) return models;
  // 按 o_modelEnable 过滤：缺少行视为启用；enabled=0 隐藏
  const disabledSet = await getDisabledModelSet(id);
  if (disabledSet.size === 0) return models;
  return models.filter((m) => !disabledSet.has(m.modelName));
}

/**
 * 给 admin UI 用：列出 vendor 下所有模型 + 启用状态。
 * enabled 默认 1（无记录视为启用）。
 */
export async function getModelListWithEnabled(id: string): Promise<Array<any & { enabled: number }>> {
  const models = await getRawModelList(id);
  const disabledSet = await getDisabledModelSet(id);
  return models.map((m) => ({ ...m, enabled: disabledSet.has(m.modelName) ? 0 : 1 }));
}

async function getDisabledModelSet(vendorId: string): Promise<Set<string>> {
  const rows = await u.db("o_modelEnable").where("vendorId", vendorId).where("enabled", 0).select("modelName");
  return new Set(rows.map((r: { modelName: string }) => r.modelName));
}

/**
 * 批量 upsert 模型启用状态。SQLite 和 PG 都通用：先 update，再 insert 没命中的。
 */
export async function setModelsEnable(
  vendorId: string,
  items: Array<{ modelName: string; enabled: number | boolean }>,
): Promise<void> {
  const now = Date.now();
  for (const it of items) {
    const enabled = it.enabled === true || Number(it.enabled) === 1 ? 1 : 0;
    const updated = await u
      .db("o_modelEnable")
      .where({ vendorId, modelName: it.modelName })
      .update({ enabled, updateTime: now });
    if (!updated) {
      await u.db("o_modelEnable").insert({
        vendorId,
        modelName: it.modelName,
        enabled,
        createTime: now,
        updateTime: now,
      });
    }
  }
}

export function getVendor(id: string) {
  const code = getCode(id);
  const jsCode = transform(code, { transforms: ["typescript"] }).code;
  const vendorData = u.vm(jsCode);
  return vendorData.vendor;
}
