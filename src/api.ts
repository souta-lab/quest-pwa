export async function api<T = any>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const r = await fetch("/api" + path, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    credentials: "same-origin",
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json()) as any;
  if (!r.ok) throw new ApiError(data.error ?? "通信に失敗しました。", r.status);
  return data;
}
import { readSSE } from "../shared/sse";
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function streamApi(
  path: string,
  body: unknown,
  handlers: {
    delta: (text: string) => void;
    status: (stage: string) => void;
  },
  signal: AbortSignal,
) {
  const response = await fetch("/api" + path, {
    method: "POST",
    credentials: "same-origin",
    signal,
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = (await response.json()) as any;
    throw new ApiError(
      data.error ?? "返信を取得できませんでした。",
      response.status,
    );
  }
  if (!response.headers.get("Content-Type")?.includes("text/event-stream")) {
    const data = (await response.json()) as any;
    if (typeof data.text !== "string" || !data.text.trim())
      throw Error("AIから有効な返信がありませんでした。");
    handlers.delta(data.text);
    return data.text as string;
  }
  if (!response.body) throw Error("返信を取得できませんでした。");
  let text = "",
    complete = false;
  for await (const event of readSSE(response.body)) {
    let data: any;
    try {
      data = JSON.parse(event.data);
    } catch {
      throw Error("返信の形式を確認できませんでした。同じ質問を再送できます。");
    }
    if (event.event === "delta" && typeof data.text === "string") {
      text += data.text;
      handlers.delta(data.text);
    } else if (event.event === "status" && typeof data.stage === "string")
      handlers.status(data.stage);
    else if (event.event === "error")
      throw new ApiError(
        data.message ?? "返信が中断しました。",
        data.status ?? 502,
      );
    else if (event.event === "done" && data.complete === true) complete = true;
  }
  if (!complete || !text.trim())
    throw Error(
      "通信が途中で切れました。同じ質問を再送すると処理結果を確認できます。",
    );
  return text;
}
