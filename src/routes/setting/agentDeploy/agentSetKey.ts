import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { userIdOf } from "@/utils/ownership";
import { upsertForUser } from "@/utils/perUserSetting";
const router = express.Router();

// 一键填入 Toonflow API key + 配置 agent 默认走 toonflow 模型。
// per-user：每个用户的 toonflow vendor inputValues + 自己的 agentDeploy 行都独立。
// 全局 admin 默认（userId=NULL）的 toonflow inputValues 不动；普通用户写自己的覆盖行。
export default router.post(
  "/",
  validateFields({
    key: z.string().optional(),
  }),
  async (req, res) => {
    const userId = userIdOf(req);
    const { key } = req.body;

    // 取当前用户的 toonflow vendor 行（fall-through：自己 → admin → 全局 NULL）
    const adminRow = await u.db("o_vendorConfig").where({ id: "toonflow" }).whereNull("userId").first();
    const userRow = await u.db("o_vendorConfig").where({ id: "toonflow", userId }).first();
    const baseInputValues = (userRow?.inputValues ?? adminRow?.inputValues) as string | null;
    if (!baseInputValues) return res.status(500).send(error("未找到 toonflow 供应商配置"));
    const inputValue = JSON.parse(baseInputValues);
    inputValue.apiKey = key;

    // 写当前用户的 toonflow vendor 行
    await upsertForUser("o_vendorConfig", userId, { id: "toonflow" }, {
      inputValues: JSON.stringify(inputValue),
    });

    try {
      const resText = await u.Ai.Text(`toonflow:claude-haiku-4-5-20251001`).invoke({
        prompt: "1+1等于几？,请直接回答2，不要解释",
      });
      if (resText.text) {
        // 把当前用户的 agent 默认行写到 toonflow 模型（per-user agentDeploy）
        await upsertForUser("o_agentDeploy", userId, { key: "scriptAgent" }, {
          model: "claude-sonnet-4-6",
          modelName: "toonflow:claude-sonnet-4-6",
          vendorId: "toonflow",
        });
        await upsertForUser("o_agentDeploy", userId, { key: "productionAgent" }, {
          model: "claude-sonnet-4-6",
          modelName: "toonflow:claude-sonnet-4-6",
          vendorId: "toonflow",
        });
        await upsertForUser("o_agentDeploy", userId, { key: "universalAi" }, {
          model: "claude-haiku-4-5",
          modelName: "toonflow:claude-haiku-4-5-20251001",
          vendorId: "toonflow",
        });
        return res.status(200).send(success("一键填入成功"));
      }
    } catch (err) {
      console.error(err);
      // 失败回滚：清空 user 行的 apiKey
      inputValue.apiKey = "";
      await upsertForUser("o_vendorConfig", userId, { id: "toonflow" }, {
        inputValues: JSON.stringify(inputValue),
      });
      return res.status(400).send(error("KEY无效，请重新输入"));
    }
  },
);
