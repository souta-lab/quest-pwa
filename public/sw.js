// Online-first PWA. Never cache authenticated APIs, answers or API keys.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  if (event.request.method === "GET" && event.request.mode === "navigate")
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            '<meta charset="utf-8"><p>QUESTはオンラインで利用できます。接続後に再読み込みしてください。</p>',
            { headers: { "Content-Type": "text/html;charset=utf-8" } },
          ),
      ),
    );
});
