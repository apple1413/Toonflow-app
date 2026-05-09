import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/productionAgent/index";
import ResTool from "@/socket/resTool";
import { authSocketAgentContext } from "@/socket/auth";
import { assertOwnsProject, assertOwnsScript } from "@/utils/ownership";

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    const auth = socket.handshake.auth;
    const userId = await authSocketAgentContext(
      socket,
      { projectId: auth.projectId, scriptId: auth.scriptId, isolationKey: auth.isolationKey },
      "productionAgent",
    );
    if (userId == null) return;

    let isolationKey: string = auth.isolationKey;

    console.log("[productionAgent] 已连接:", socket.id, "user:", userId);

    let resTool = new ResTool(socket, {
      projectId: auth.projectId,
      scriptId: auth.scriptId,
    });
    let abortController: AbortController | null = null;

    const thinkConfig: agent.AgentContext["thinkConfig"] = {
      think: false,
      thinlLevel: 0,
    };

    socket.on("updateContext", async (data: { isolationKey: string; projectId: number; scriptId: number }, callback) => {
      // 切换上下文同样要重做归属校验，否则连接建立后可改成他人项目
      try {
        await assertOwnsProject(userId, data.projectId);
        if (data.scriptId != null) await assertOwnsScript(userId, data.scriptId);
        if (typeof data.isolationKey !== "string" || !data.isolationKey.startsWith(`${data.projectId}:`)) {
          throw new Error("isolationKey 与 projectId 不匹配");
        }
      } catch (e: any) {
        console.log("[productionAgent] updateContext 拒绝:", e?.message);
        callback?.({ success: false, message: e?.message ?? "无权切换该上下文" });
        return;
      }
      isolationKey = data.isolationKey;
      resTool = new ResTool(socket, {
        projectId: data.projectId,
        scriptId: data.scriptId,
      });
      console.log("[productionAgent] 上下文已更新:", isolationKey);
      callback?.({ success: true });
    });

    socket.on("chat", async (data: { content: string }) => {
      const { content } = data;
      abortController?.abort();
      abortController = new AbortController();
      const currentController = abortController;

      const msg = resTool.newMessage("assistant", "视频策划");
      const ctx: agent.AgentContext = {
        socket,
        isolationKey,
        text: content,
        userMessageTime: new Date(msg.datetime).getTime() - 1,
        abortSignal: currentController.signal,
        resTool,
        msg,
        thinkConfig,
      };

      try {
        await agent.runDecisionAI(ctx);
      } catch (err: any) {
        if (err.name !== "AbortError" && !currentController.signal.aborted) {
          console.error("[productionAgent] chat error:", u.error(err).message);
        }
      } finally {
        if (abortController === currentController) {
          abortController = null;
        }
      }
    });

    socket.on("updateThinkConfig", (data: { think: boolean; thinlLevel: 0 | 1 | 2 | 3 }) => {
      thinkConfig.think = data.think;
      thinkConfig.thinlLevel = data.thinlLevel;
      console.log("[productionAgent] 更新思考配置:", thinkConfig);
    });

    socket.on("stop", () => {
      abortController?.abort();
      abortController = null;
    });
  });
  nsp.on("disconnect", (socket: Socket) => {
    console.log("[productionAgent] 已断开连接:", socket.id);
  });
};
