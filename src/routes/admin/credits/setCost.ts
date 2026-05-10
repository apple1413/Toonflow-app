import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAdminAsync } from "@/utils/ownership";
import { setCost } from "@/utils/credits";
const router = express.Router();

// admin 修改某场景的扣费数量；写到 o_setting 全局行 key='cost.<scene>'
export default router.post(
  "/",
  validateFields({
    scene: z.string().min(1),
    amount: z.number().min(0),
  }),
  async (req, res) => {
    await assertAdminAsync(req);
    const { scene, amount } = req.body;
    try {
      await setCost(scene, amount);
    } catch (e: any) {
      return res.status(400).send(error(e?.message ?? "设置失败"));
    }
    res.status(200).send(success(`${scene} = ${amount}`));
  },
);
