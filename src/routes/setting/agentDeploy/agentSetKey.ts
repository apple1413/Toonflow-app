import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
import { assertAdminAsync } from "@/utils/ownership";
const router = express.Router();

// 一键填入 Toonflow API key + 配置 agent 默认走 toonflow 模型。
// vendor / agent 配置全局共享：只允许 admin 调，落 NULL 全局行。
async function upsertGlobal(table: "o_vendorConfig" | "o_agentDeploy", keyCols: Record<string, any>, fields: Record<string, any>) {
  const existing = await u.db(table).where(keyCols).whereNull("userId").first();
  if (existing) {
    await u.db(table).where(keyCols).whereNull("userId").update(fields);
  } else {
    await u.db(table).insert({ ...keyCols, ...fields, userId: null as any });
  }
}

export default router.post(
  "/",
  validateFields({
    key: z.string().optional(),
  }),
  async (req, res) => {
    await assertAdminAsync(req);
    const { key } = req.body;

    // 全局 toonflow vendor 行（NULL）
    const globalRow = await u.db("o_vendorConfig").where({ id: "toonflow" }).whereNull("userId").first();
    const baseInputValues = (globalRow?.inputValues as string | null) ?? "{}";
    const inputValue = JSON.parse(baseInputValues);
    inputValue.apiKey = key;

    await upsertGlobal("o_vendorConfig", { id: "toonflow" }, {
      inputValues: JSON.stringify(inputValue),
    });

    try {
      const resText = await u.Ai.Text(`toonflow:claude-haiku-4-5-20251001`).invoke({
        prompt: "1+1等于几？,请直接回答2，不要解释",
      });
      if (resText.text) {
        await upsertGlobal("o_agentDeploy", { key: "scriptAgent" }, {
          model: "claude-sonnet-4-6",
          modelName: "toonflow:claude-sonnet-4-6",
          vendorId: "toonflow",
        });
        await upsertGlobal("o_agentDeploy", { key: "productionAgent" }, {
          model: "claude-sonnet-4-6",
          modelName: "toonflow:claude-sonnet-4-6",
          vendorId: "toonflow",
        });
        await upsertGlobal("o_agentDeploy", { key: "universalAi" }, {
          model: "claude-haiku-4-5",
          modelName: "toonflow:claude-haiku-4-5-20251001",
          vendorId: "toonflow",
        });
        return res.status(200).send(success("一键填入成功"));
      }
    } catch (err) {
      console.error(err);
      // 失败回滚：清空全局行的 apiKey
      inputValue.apiKey = "";
      await upsertGlobal("o_vendorConfig", { id: "toonflow" }, {
        inputValues: JSON.stringify(inputValue),
      });
      return res.status(400).send(error("KEY无效，请重新输入"));
    }
  },
);
