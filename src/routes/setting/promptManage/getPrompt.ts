import express from "express";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";
import { userIdOf } from "@/utils/ownership";
import { fallthroughList } from "@/utils/perUserSetting";

const router = express.Router();

// 用户优先 + admin 默认兜底；按 type 去重（业务上每种 type 一条）
export default router.post("/", async (req, res) => {
  const userId = userIdOf(req);
  const list = await fallthroughList<any>("o_prompt", userId, "type");
  const data = list.map((item: any) => ({
    ...item,
    data: item.useData ? item.useData : item.data,
  }));
  res.status(200).send(success(data));
});
