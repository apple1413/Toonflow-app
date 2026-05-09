import express from "express";
import { success, error } from "@/lib/responseFormat";
import u from "@/utils";
import { userIdOf } from "@/utils/ownership";
import { fallthroughList } from "@/utils/perUserSetting";

const router = express.Router();

// 用户优先 + admin/NULL 默认兜底
export default router.get("/", async (req, res) => {
    const userId = userIdOf(req);
    const rows = await fallthroughList<any>("o_setting", userId, "key", (q) => q.where("key", "switchAiDevTool"));
    res.status(200).send(success(rows[0]?.value || "0"));
});
