import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { userIdOf } from "@/utils/ownership";
import { fallthroughList } from "@/utils/perUserSetting";
const router = express.Router();

// 用户优先 + admin (id=1) 默认兜底；按 key 去重，每个 agent 配置一行
export default router.post("/", async (req, res) => {
  const userId = userIdOf(req);
  const allData = await fallthroughList<any>("o_agentDeploy", userId, "key");
  const qrdinaryData = allData.filter((item: any) => !item.key?.includes(":"));
  const advancedData = allData.filter((item: any) => item.key?.includes(":"));
  res.status(200).send(success({ qrdinaryData, advancedData }));
});
