import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import path from "path";
import fs from "fs";
import u from "@/utils";
import { z } from "zod";
import { assertAdmin } from "@/utils/ownership";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    id: z.string(),
  }),
  async (req, res) => {
    assertAdmin(req);
    const { id } = req.body;
    // admin 删除 vendor：清除所有同 id 行（含历史 admin/user 行 + NULL 全局行）
    await u.db("o_vendorConfig").where("id", id).del();
    // agentDeploy 全局共享，仅清 NULL 全局行的引用
    await u.db("o_agentDeploy").where("vendorId", id).whereNull("userId").update({
      model: null,
      vendorId: null,
    });
    fs.rmSync(path.join(u.getPath("vendor"), `${id}.ts`), { recursive: true, force: true });
    res.status(200).send(success("删除成功"));
  },
);
