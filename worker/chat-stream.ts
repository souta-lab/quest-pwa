import { HttpError } from "./security";
export function chatStream(
  task: (
    send: (event: string, data: unknown) => void,
    signal: AbortSignal,
  ) => Promise<void>,
  ctx?: ExecutionContext,
) {
  const abort = new AbortController(),
    encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (!abort.signal.aborted)
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
      };
      const work = task(send, abort.signal)
        .catch((error) => {
          send("error", {
            message:
              error instanceof HttpError
                ? error.message
                : "返信が中断しました。もう一度送信できます。",
            status: error instanceof HttpError ? error.status : 502,
          });
        })
        .finally(() => {
          if (!abort.signal.aborted) controller.close();
        });
      if (ctx) ctx.waitUntil(work);
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream;charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
