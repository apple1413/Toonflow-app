import express from "express";
import initDB from "@/lib/initDB";
import { db } from "@/utils/db";
import { success, error } from "@/lib/responseFormat";
import { isEletron } from "@/utils/getPath";
const router = express.Router();

// 清空数据表（DROP TABLE + 重建）
// 这是历史上 Electron 单机版的"重置我的本地数据"按钮。
// SaaS 多租户场景下任何登录用户都能擦掉所有用户的所有表，绝不能在云库上跑。
// 仅在 Electron 进程内允许调用；非 Electron（SaaS server）一律拒绝。
export default router.post(
    "/",
    async (req, res) => {
        if (!isEletron()) {
            return res.status(403).send(error("该接口仅在桌面端可用"));
        }
        await initDB(db, true);
        res.status(200).send(success({ message: "清空数据表成功" }));
    },
);
