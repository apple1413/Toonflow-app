import express from "express";
import crypto from "crypto";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { assertAdminAsync } from "@/utils/ownership";
import { hashPassword } from "@/utils/password";
const router = express.Router();

// 生成 16 字符的随机密码（admin 把它复制给被邀请用户）
function genPassword(): string {
  return crypto.randomBytes(12).toString("base64url").slice(0, 16);
}

// admin 创建新用户。返回明文初始密码（仅这一次返回，DB 存的是 bcrypt）。
// 用户拿到后用 form-login 登录，进去后用 updateUserPwd 改自己的密码。
export default router.post(
  "/",
  validateFields({
    name: z.string().min(1),
    role: z.enum(["admin", "user"]).optional(),
    email: z.string().email().optional().nullable(),
  }),
  async (req, res) => {
    await assertAdminAsync(req);
    const { name, role = "user", email } = req.body;

    const exists = await u.db("o_user").where({ name }).first();
    if (exists) return res.status(400).send(error(`用户名 ${name} 已存在`));

    const password = genPassword();
    const hashed = await hashPassword(password);
    const id = Date.now();
    await u.db("o_user").insert({
      id,
      name,
      password: hashed,
      role,
      email: email ?? null,
      createTime: id,
      disabled: false,
    });
    res.status(200).send(
      success({
        id,
        name,
        role,
        password, // 一次性明文回显——admin 复制给被邀用户
      }),
    );
  },
);
