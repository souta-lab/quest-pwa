import { fail, open, validateBase, HttpError, type Env } from "./security";
import { readSSE } from "../shared/sse";
import { APP_VERSION } from "../shared/release";
export type Provider = {
  format: string;
  base_url: string;
  model: string;
  ciphertext: string;
  iv: string;
  opencode_session?: string;
};
/** Session IDs are metadata, not credentials. Never forward inbound request headers. */
export function llmHeaders(provider: Provider, key: string) {
  return {
    "Content-Type": "application/json",
    "User-Agent": `quest-pwa/${APP_VERSION}`,
    "x-opencode-session": provider.opencode_session || crypto.randomUUID(),
    ...(provider.format === "anthropic"
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${key}` }),
  };
}
export type Usage = { input: number | null; output: number | null };
export type LLMExample = { user: string; assistant: string };
export async function providerFor(env: Env, id: string) {
  const p = await env.DB.prepare(
    "SELECT * FROM provider_configs WHERE user_id=?",
  )
    .bind(id)
    .first<Provider>();
  if (!p)
    fail(400, "設定画面でBYOKの接続先・モデル・APIキーを登録してください。");
  return p;
}
function tokens(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 10000000
    ? value
    : null;
}
async function boundedJSON(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) fail(502, "AIから有効な応答がありませんでした。");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.byteLength;
    if (size > 200000) {
      await reader.cancel();
      fail(502, "AIの応答が大きすぎます。");
    }
    chunks.push(r.value);
  }
  const data = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    data.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    fail(502, "AIから有効な応答がありませんでした。");
  }
}
async function requestLLM(
  env: Env,
  provider: Provider,
  model: string,
  system: string,
  message: string,
  maxTokens = 1800,
  examples: readonly LLMExample[] = [],
  stream = false,
  signal?: AbortSignal,
) {
  const key = await open(provider.ciphertext, provider.iv, env),
    anthropic = provider.format === "anthropic";
  const endpoint =
    validateBase(provider.base_url) +
    (anthropic ? "/messages" : "/chat/completions");
  // DeepSeek counts reasoning tokens inside max_tokens. Reserve room for a final answer.
  const deepseek = !anthropic && /^deepseek(?:-|\/)/i.test(model);
  const outputBudget = deepseek ? Math.max(maxTokens, 8192) : maxTokens;
  const completionLimit =
    new URL(endpoint).hostname === "api.openai.com"
      ? { max_completion_tokens: outputBudget }
      : { max_tokens: outputBudget };
  let response: Response;
  const messages = [
    ...examples.flatMap((e) => [
      { role: "user", content: e.user },
      { role: "assistant", content: e.assistant },
    ]),
    { role: "user", content: message },
  ];
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      signal: signal
        ? AbortSignal.any([
            AbortSignal.timeout(deepseek ? 90000 : 45000),
            signal,
          ])
        : AbortSignal.timeout(deepseek ? 90000 : 45000),
      headers: llmHeaders(provider, key),
      body: JSON.stringify(
        anthropic
          ? {
              model,
              max_tokens: maxTokens,
              system,
              messages,
              ...(stream ? { stream: true } : {}),
            }
          : {
              model,
              ...completionLimit,
              ...(deepseek ? { reasoning_effort: "medium" } : {}),
              messages: [{ role: "system", content: system }, ...messages],
              ...(stream ? { stream: true } : {}),
            },
      ),
    });
  } catch {
    fail(502, "AIサービスとの通信に失敗しました。");
  }
  if (!response.ok)
    fail(502, `AIサービスに接続できませんでした（${response.status}）。`);
  return { response, anthropic };
}
async function readCompletion(response: Response, anthropic: boolean) {
  const data = await boundedJSON(response);
  const stopReason = anthropic
    ? data.stop_reason
    : data.choices?.[0]?.finish_reason;
  if (stopReason === "length" || stopReason === "max_tokens")
    fail(
      502,
      "AIが推論・回答の出力上限に達しました。回答は未完成のため表示しません。別モデルで試すか、質問を短くしてください。",
    );
  const text = anthropic
    ? data.content
        ?.filter((x: any) => x.type === "text")
        .map((x: any) => x.text)
        .join("\n")
    : data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim())
    fail(502, "AIから有効な応答がありませんでした。");
  return {
    text,
    usage: {
      input: tokens(
        anthropic ? data.usage?.input_tokens : data.usage?.prompt_tokens,
      ),
      output: tokens(
        anthropic ? data.usage?.output_tokens : data.usage?.completion_tokens,
      ),
    } satisfies Usage,
  };
}
export async function callLLM(
  env: Env,
  provider: Provider,
  model: string,
  system: string,
  message: string,
  maxTokens = 1800,
  examples: readonly LLMExample[] = [],
  signal?: AbortSignal,
) {
  const { response, anthropic } = await requestLLM(
    env,
    provider,
    model,
    system,
    message,
    maxTokens,
    examples,
    false,
    signal,
  );
  return readCompletion(response, anthropic);
}

export async function* callLLMStream(
  env: Env,
  provider: Provider,
  system: string,
  message: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const { response, anthropic } = await requestLLM(
    env,
    provider,
    provider.model,
    system,
    message,
    1600,
    [],
    true,
    signal,
  );
  // Some compatible gateways ignore stream:true and return a normal completion.
  if (!response.headers.get("Content-Type")?.includes("text/event-stream")) {
    yield (await readCompletion(response, anthropic)).text;
    return;
  }
  if (!response.body) fail(502, "AIから有効な応答がありませんでした。");
  let ended = false,
    length = 0;
  try {
    for await (const event of readSSE(response.body)) {
      if (event.data === "[DONE]") {
        ended = true;
        break;
      }
      let value: any;
      try {
        value = JSON.parse(event.data);
      } catch {
        fail(502, "AIのストリーム形式を確認できませんでした。");
      }
      if (value.error || value.type === "error")
        fail(502, "AIの応答が途中で中断しました。もう一度送信できます。");
      const reason = anthropic
        ? value.delta?.stop_reason
        : value.choices?.[0]?.finish_reason;
      if (reason === "length" || reason === "max_tokens")
        fail(
          502,
          "AIの応答が出力上限で中断しました。質問を短くして再送できます。",
        );
      if (reason || value.type === "message_stop") ended = true;
      const delta = anthropic
        ? value.type === "content_block_delta" &&
          value.delta?.type === "text_delta"
          ? value.delta.text
          : undefined
        : value.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        length += delta.length;
        if (length > 12000)
          fail(502, "AIの返答が長すぎます。質問を短くして再送できます。");
        yield delta;
      }
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(502, "AIの応答が途中で中断しました。もう一度送信できます。");
  }
  if (!ended || !length)
    fail(502, "AIの応答が途中で中断しました。もう一度送信できます。");
}
export function parseObject(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    fail(502, "作問のJSON形式を確認できませんでした。");
  }
}
