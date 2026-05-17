// 自动加载项目根目录 .env（dev / pm2 / docker 都通过 cwd 找；Electron 打包后无 .env 文件时静默 no-op）
import "dotenv/config";

// 判断是否为打包后的 Electron 环境
const isElectron = typeof process.versions?.electron !== "undefined";
let isPackaged = false;
if (isElectron) {
  const { app } = require("electron");
  isPackaged = app.isPackaged;
}

//加载环境变量（打包环境默认使用 prod）
const env = process.env.NODE_ENV;
if (!env) {
  if (isElectron) process.env.NODE_ENV = "prod";
  else process.env.NODE_ENV = "dev";
  console.log(`[环境变量：${process.env.NODE_ENV}]`);
}
