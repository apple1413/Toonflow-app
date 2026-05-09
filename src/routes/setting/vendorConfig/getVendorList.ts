import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { userIdOf } from "@/utils/ownership";
import { fallthroughList } from "@/utils/perUserSetting";
const router = express.Router();

// per-user vendor 配置：每个用户的 inputValues（API key 等）独立
// fall-through：用户行优先 → admin 行（不存在）→ NULL 系统默认（vendor type）
// vendor 文件系统的 code/description/inputs 由 u.vendor.getVendor 读，全局共享
export default router.post("/", async (req, res) => {
  const userId = userIdOf(req);
  const data = await fallthroughList<any>("o_vendorConfig", userId, "id");

  const list = (
    await Promise.all(
      data.map(async (item: any) => {
        const vendor = u.vendor.getVendor(item.id!);
        if (!vendor) {
          // vendor 文件已不存在——用户/全局两份都清掉
          await u.db("o_vendorConfig").where("id", item.id).delete();
          return null;
        }
        return {
          ...item,
          inputValues: JSON.parse(item.inputValues ?? "{}"),
          models: await u.vendor.getModelList(item.id!),
          code: u.vendor.getCode(item.id!),
          description: vendor.description ?? "",
          inputs: vendor.inputs,
          author: vendor.author,
          name: vendor.name,
          version: vendor.version ?? "1.0",
        };
      }),
    )
  ).filter((i) => Boolean(i));

  list.sort((a, b) => (a!.id === "toonflow" ? -1 : b!.id === "toonflow" ? 1 : 0));
  res.status(200).send(success(list));
});
