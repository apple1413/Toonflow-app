import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { assertAdmin } from "@/utils/ownership";
const router = express.Router();
// 让前端传 URL 由后端代理 fetch（绕过 CORS）。被滥用可拿来扫内网，所以一并锁 admin。
export default router.post(
  "/",
  validateFields({
    link: z.string(),
  }),
  async (req, res) => {
    assertAdmin(req);
    const { link } = req.body;
    const text = await fetch(link).then((res) => res.text());
    res.status(200).send(success(text));
  },
);
