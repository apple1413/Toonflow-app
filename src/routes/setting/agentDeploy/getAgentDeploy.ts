import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
const router = express.Router();

// agent 配置全局共享：所有租户读 userId IS NULL 的全局行
export default router.post("/", async (req, res) => {
  const allData = await u.db("o_agentDeploy").whereNull("userId").select("*");
  const qrdinaryData = allData.filter((item: any) => !item.key?.includes(":"));
  const advancedData = allData.filter((item: any) => item.key?.includes(":"));
  res.status(200).send(success({ qrdinaryData, advancedData }));
});
