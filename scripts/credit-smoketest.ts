import { estimateCostForModel, MODEL_COSTS } from "../src/utils/credits";

async function main() {
  const cases: Array<{
    label: string;
    vendor: string;
    model: string;
    kind: "image" | "video";
    input: any;
    expected: number;
  }> = [
    { label: "Sora 2 Pro 1080p 10s + audio", vendor: "apimart", model: "sora-2-pro", kind: "video",
      input: { duration: 10, resolution: "1080p", audio: true }, expected: 2160 },
    { label: "Sora 2 720p 5s", vendor: "apimart", model: "sora-2", kind: "video",
      input: { duration: 5, resolution: "720p", audio: false }, expected: 182 },
    { label: "Wan 2.6 5s 720p", vendor: "apimart", model: "wan2.6", kind: "video",
      input: { duration: 5, resolution: "720p", audio: false }, expected: 127 },
    { label: "Kling v3 5s 720p", vendor: "apimart", model: "kling-v3", kind: "video",
      input: { duration: 5, resolution: "720p" }, expected: 59 },
    { label: "Seedance 2.0 720p 5s + audio", vendor: "apimart", model: "doubao-seedance-2.0", kind: "video",
      input: { duration: 5, resolution: "720p", audio: true }, expected: 237 },
    { label: "Veo 3.1 Quality 1080p 8s", vendor: "apimart", model: "veo3.1-quality", kind: "video",
      input: { duration: 8, resolution: "1080p" }, expected: 1936 },
    { label: "GPT-Image-2", vendor: "apimart", model: "gpt-image-2", kind: "image",
      input: { count: 1 }, expected: 3 },
    { label: "Imagen 4.0", vendor: "apimart", model: "imagen-4.0", kind: "image",
      input: { count: 1 }, expected: 21 },
    { label: "Seedream 5 Lite (apimart 估)", vendor: "apimart", model: "doubao-seedream-5-0-lite", kind: "image",
      input: { count: 1 }, expected: 16 },
    { label: "Volc Seedream 4 (官价 ¥0.20)", vendor: "volcengine", model: "doubao-seedream-4-0", kind: "image",
      input: { count: 1 }, expected: 14 },
    { label: "未知模型 fallback=0", vendor: "apimart", model: "non-existent", kind: "video",
      input: { duration: 5, resolution: "720p" }, expected: 0 },
  ];
  console.log("MODEL_COSTS keys count:", Object.keys(MODEL_COSTS).length);
  console.log();
  console.log("model                                | expected | actual");
  console.log("-".repeat(60));
  for (const c of cases) {
    const actual = await estimateCostForModel(c.vendor, c.model, c.kind, c.input);
    const ok = Math.abs(actual - c.expected) <= 2 ? "OK" : "FAIL";
    console.log(`${c.label.padEnd(37)} | ${String(c.expected).padStart(7)}  | ${String(actual).padStart(6)} ${ok}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

// === 文本扩展用例（plan C：perTextCall 平均价）===
async function textCases() {
  const { estimateCostForModel } = await import("../src/utils/credits");
  const cases = [
    { v: "volcengine", m: "doubao-seed-2-0-pro-260215", expected: 2 }, // ¥0.024 × 70 = 1.68 → ceil=2
    { v: "volcengine", m: "doubao-seed-1-6",            expected: 1 }, // ¥0.005 × 70 = 0.35 → max(1)
    { v: "volcengine", m: "doubao-seed-1-6-lite",       expected: 1 },
    { v: "apimart",    m: "gpt-5",                      expected: 61 }, // $0.12*7.2*70 = 60.48 → ceil=61
    { v: "apimart",    m: "claude-sonnet-4-5",          expected: 25 }, // $0.048*7.2*70 = 24.19 → ceil=25
    { v: "apimart",    m: "gemini-2.0-flash",           expected: 1 },  // 0.001*7.2*70 = 0.504 → max(1)
  ];
  console.log("\n=== 文本计费（perTextCall）===");
  console.log("model                                   | expected | actual");
  console.log("-".repeat(64));
  for (const c of cases) {
    const actual = await estimateCostForModel(c.v, c.m, "text", {});
    const tag = Math.abs(actual - c.expected) <= 1 ? "OK" : "FAIL";
    console.log(`${(c.v + "." + c.m).padEnd(42)}| ${String(c.expected).padStart(7)}  | ${String(actual).padStart(6)} ${tag}`);
  }
}
textCases().catch((e) => { console.error(e); process.exit(1); });
