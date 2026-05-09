import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf } from "@/utils/ownership";
import { upsertForUser } from "@/utils/perUserSetting";
const router = express.Router();

// per-user：每个 key 写当前用户行；NULL/admin 默认行不变
export default router.post(
  "/",
  validateFields({
    messagesPerSummary: z.number(),
    shortTermLimit: z.number(),
    summaryMaxLength: z.number(),
    summaryLimit: z.number(),
    ragLimit: z.number(),
    deepRetrieveSummaryLimit: z.number(),
    modelOnnxFile: z.array(z.string()),
    modelDtype: z.string(),
  }),
  async (req, res) => {
    const userId = userIdOf(req);
    const { messagesPerSummary, shortTermLimit, summaryMaxLength, summaryLimit, ragLimit, deepRetrieveSummaryLimit, modelOnnxFile, modelDtype } =
      req.body;

    const setForUser = (key: string, value: string) => upsertForUser("o_setting", userId, { key }, { value });

    await setForUser("messagesPerSummary", String(messagesPerSummary));
    await setForUser("shortTermLimit", String(shortTermLimit));
    await setForUser("summaryMaxLength", String(summaryMaxLength));
    await setForUser("summaryLimit", String(summaryLimit));
    await setForUser("ragLimit", String(ragLimit));
    await setForUser("deepRetrieveSummaryLimit", String(deepRetrieveSummaryLimit));
    await setForUser("modelOnnxFile", JSON.stringify(modelOnnxFile));
    await setForUser("modelDtype", modelDtype);

    res.status(200).send(success("保存设置成功"));
  },
);
