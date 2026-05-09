import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { assertAdmin } from "@/utils/ownership";
const router = express.Router();

// 直接回显 inputValues（含 API key 等敏感字段），仅 admin 可见。
// 等 P3-a 拍方向后若改为 vendor per-user，再按当前用户过滤
export default router.post("/", async (req, res) => {
  assertAdmin(req);
  const data = await u.db("o_vendorConfig").select("*");

  const list = (
    await Promise.all(
      data.map(async (item) => {
        const vendor = u.vendor.getVendor(item.id!);
        if (!vendor) {
          await u.db("o_vendorConfig").where("id", item.id).delete();
          return null
        };
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
