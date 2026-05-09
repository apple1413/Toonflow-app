import express from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { userIdOf } from "@/utils/ownership";
import { fallthroughList } from "@/utils/perUserSetting";
const router = express.Router();

const MEMORY_KEYS = [
  "messagesPerSummary",
  "shortTermLimit",
  "summaryMaxLength",
  "summaryLimit",
  "ragLimit",
  "deepRetrieveSummaryLimit",
  "modelOnnxFile",
  "modelDtype",
] as const;

export default router.get("/", async (req, res) => {
  const userId = userIdOf(req);
  // 用户优先 + admin (id=1) 默认 + NULL（系统默认，如 modelOnnxFile）兜底；按 key 去重
  const settingData = await fallthroughList<any>(
    "o_setting",
    userId,
    "key",
    (q) => q.whereIn("key", MEMORY_KEYS as any),
  );

  if (!settingData) return res.status(400).send(error(`获取记忆配置失败`));
  const memoryObj: Record<string, number | string | string[]> = {};

  settingData.forEach((i) => {
    if (i.key && i.value) {
      let value: number | string | string[] = i.value;
      if (i.key == "modelOnnxFile") {
        value = JSON.parse(i.value);
      } else if (i.key != "modelDtype") {
        value = Number(value);
      }
      memoryObj[i.key] = value;
    }
  });

  res.status(200).send(success({ ...memoryObj }));
});
