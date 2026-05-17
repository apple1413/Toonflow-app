import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/scriptAgent/index";
import ResTool from "@/socket/resTool";
import { authSocketAgentContext } from "@/socket/auth";
import { runWithUser } from "@/utils/requestContext";

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    const auth = socket.handshake.auth;
    // scriptAgent 只用 projectId，没有 scriptId
    const userId = await authSocketAgentContext(
      socket,
      { projectId: auth.projectId, isolationKey: auth.isolationKey },
      "scriptAgent",
    );
    if (userId == null) return;

    const isolationKey: string = auth.isolationKey;

    console.log("[scriptAgent] 已连接:", socket.id, "user:", userId);

    const resTool = new ResTool(socket, {
      projectId: auth.projectId,
    });
    let abortController: AbortController | null = null;

    const thinkConfig: agent.AgentContext["thinkConfig"] = {
      think: false,
      thinlLevel: 0,
    };

    socket.on("chat", async (data: { content: string }) => {
      const { content } = data;
      abortController?.abort();
      abortController = new AbortController();
      const currentController = abortController;

      const msg = resTool.newMessage("assistant", "统筹");
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
        // socket 通道走的是 socket.io，不经过 Express JWT 中间件的 AsyncLocalStorage 注入，
        // 所以 agent 深层调用 getRequestUserId() 会拿到 null，导致 per-user 配置 fall-through
        // 全部走 NULL 全局默认分支，找不到当前用户保存的 o_agentDeploy 行。
        // 这里手动用 runWithUser 把 socket 的 userId 注入 ALS，与 HTTP 路径行为对齐。
        await runWithUser(userId, () => agent.runDecisionAI(ctx));
      } catch (err: any) {
        if (err.name !== "AbortError" && !currentController.signal.aborted) {
          console.error("[scriptAgent] chat error:", u.error(err).message);
          msg.error(u.error(err).message)
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
      console.log("[scriptAgent] 更新思考配置:", thinkConfig);
    });

    socket.on("stop", () => {
      abortController?.abort();
      abortController = null;
    });
  });
  nsp.on("disconnect", (socket: Socket) => {
    console.log("[scriptAgent] 已断开连接:", socket.id);
  });
};
