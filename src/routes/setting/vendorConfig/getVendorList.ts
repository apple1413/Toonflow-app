import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
const router = express.Router();

// vendor 配置全局共享：所有租户读 userId IS NULL 的全局行
// vendor 文件系统的 code/description/inputs 由 u.vendor.getVendor 读，全局共享
export default router.post("/", async (req, res) => {
  const data = await u.db("o_vendorConfig").whereNull("userId").select("*");

  const list = (
    await Promise.all(
      data.map(async (item: any) => {
        const vendor = u.vendor.getVendor(item.id!);
        if (!vendor) {
          // vendor 文件已不存在——清掉对应行
          await u.db("o_vendorConfig").where("id", item.id).whereNull("userId").delete();
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
