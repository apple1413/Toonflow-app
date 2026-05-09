import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { assertAdmin } from "@/utils/ownership";
const router = express.Router();

// 这个接口写全局 o_vendorConfig.inputValues 的 toonflow API key，并改 admin 默认的
// agent 行（key='scriptAgent' 等），属于 admin 一键托管模式。
// per-user vendor 等后续重构再放开；现阶段锁 admin。
export default router.post(
  "/",
  validateFields({
    key: z.string().optional(),
  }),
  async (req, res) => {
    assertAdmin(req);
    const { key } = req.body;
    const vendorConfigData = await u.db("o_vendorConfig").where("id", "toonflow").first();
    if (!vendorConfigData) return res.status(500).send(error("未找到该供应商配置"));
    if (!vendorConfigData.inputValues) return res.status(500).send(error("未找到模型配置数据"));
    const inputValue = JSON.parse(vendorConfigData.inputValues!);
    inputValue.apiKey = key;
    await u
      .db("o_vendorConfig")
      .where("id", "toonflow")
      .update({
        inputValues: JSON.stringify(inputValue),
      });
    try {
      const resText = await u.Ai.Text(`toonflow:claude-haiku-4-5-20251001`).invoke({
        prompt: "1+1等于几？,请直接回答2，不要解释",
      });
      if (resText.text) {
        await u.db("o_agentDeploy").where("key", "scriptAgent").update({
          model: "claude-sonnet-4-6",
          modelName: "toonflow:claude-sonnet-4-6",
          vendorId: "toonflow",
        });
        await u.db("o_agentDeploy").where("key", "productionAgent").update({
          model: "claude-sonnet-4-6",
          modelName: "toonflow:claude-sonnet-4-6",
          vendorId: "toonflow",
        });
        await u.db("o_agentDeploy").where("key", "universalAi").update({
          model: "claude-haiku-4-5",
          modelName: "toonflow:claude-haiku-4-5-20251001",
          vendorId: "toonflow",
        });
        res.status(200).send(success("一键填入成功"));
      }
    } catch (err) {
      console.error(err);
      inputValue.apiKey = "";
      await u
        .db("o_vendorConfig")
        .where("id", "toonflow")
        .update({ inputValues: JSON.stringify(inputValue) });
      res.status(400).send(error("KEY无效，请重新输入"));
    }
  },
);
