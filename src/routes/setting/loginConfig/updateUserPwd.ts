import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { userIdOf } from "@/utils/ownership";
const router = express.Router();

// 注意：原实现接受 body.id 并据此 update，意味着任意登录用户能改任何账号的密码。
// 现在 id 一律来自 JWT（req.user.id），body.id 即便传也忽略
export default router.post(
  "/",
  validateFields({
    name: z.string(),
    password: z.string(),
  }),
  async (req, res) => {
    const userId = userIdOf(req);
    const { name, password } = req.body;
    await u.db("o_user").where({ id: userId }).update({
      name,
      password,
    });
    res.status(200).send(success("保存设置成功"));
  },
);
