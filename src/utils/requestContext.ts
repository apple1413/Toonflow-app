import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 请求级用户上下文。
 *
 * 用途：让深层调用栈（agent / ai.ts / vendor 适配器）能拿到当前请求的用户 ID，
 * 用于按用户扣费 / per-user vendor inputValues / 审计日志等场景，
 * 避免一路 prop-drilling 把 userId 传过去。
 *
 * 注入点：app.ts JWT 中间件 verify 通过后用 ctx.run({userId}, next) 包一层。
 * 读取点：ai.ts AiText.invoke/stream 在扣费时调 getRequestUserId()。
 *
 * AsyncLocalStorage 跨 async/await 和 Promise 链自动传播，
 * 即使 stream usage Promise 在请求响应后才 resolve 也能拿到原始 userId。
 */

interface RequestCtx {
  userId: number;
}

const storage = new AsyncLocalStorage<RequestCtx>();

export function runWithUser<T>(userId: number, fn: () => T): T {
  return storage.run({ userId }, fn);
}

export function getRequestUserId(): number | null {
  const ctx = storage.getStore();
  return ctx?.userId ?? null;
}
