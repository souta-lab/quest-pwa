export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  GENERATION_QUEUE?: Queue<{ jobId: string }>;
  APP_ORIGIN: string;
  LOCAL_DEV?: string;
  ENCRYPTION_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
};
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
const encoder = new TextEncoder();
export const b64 = (data: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(data)));
export const unb64 = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const token = () =>
  b64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export async function hash(s: string) {
  return b64(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
}
export async function password(
  value: string,
  salt = token(),
  iterations = 100000,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(value),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: iterations,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return `pbkdf2-sha256$${iterations}$${salt}$${b64(bits)}`;
}
const passwordPrefix = "pbkdf2-sha256-hmac-v1$100000$";
async function protectPassword(encoded: string, env: Env) {
  if (!env.ENCRYPTION_KEY) fail(503, "認証用の暗号鍵が未設定です。");
  const raw = unb64(env.ENCRYPTION_KEY);
  if (raw.length !== 32) fail(503, "認証用の暗号鍵の設定が不正です。");
  // Domain-separated HKDF key: do not use the BYOK AES key directly for HMAC.
  const root = await crypto.subtle.importKey("raw", raw, "HKDF", false, [
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: encoder.encode("QUEST password pepper v1"),
    },
    root,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  return b64(await crypto.subtle.sign("HMAC", key, encoder.encode(encoded)));
}
export async function accountPassword(value: string, env: Env, salt = token()) {
  const encoded = await password(value, salt, 100000);
  return passwordPrefix + salt + "$" + (await protectPassword(encoded, env));
}
export const passwordNeedsUpgrade = (stored: string) =>
  !stored.startsWith(passwordPrefix);
export async function checkPassword(value: string, stored: string, env?: Env) {
  if (stored.startsWith("pbkdf2-sha256-hmac-v1$")) {
    const parts = stored.split("$");
    if (parts.length !== 4 || parts[1] !== "100000" || !parts[2] || !parts[3])
      return false;
    if (!env) fail(503, "認証用の暗号鍵が未設定です。");
    return equal(await accountPassword(value, env, parts[2]), stored);
  }
  if (stored.startsWith("pbkdf2-sha256$")) {
    const [, n, salt] = stored.split("$");
    const iterations = Number(n);
    if (
      !Number.isInteger(iterations) ||
      iterations < 100000 ||
      iterations > 600000 ||
      !salt
    )
      return false;
    return equal(await password(value, salt, iterations), stored);
  }
  const [salt, digest] = stored.split(".");
  if (!salt || !digest) return false;
  const computed = await password(value, salt, 100000);
  return equal(computed.split("$")[3], digest);
}
export async function cleanup(env: Env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at<? LIMIT 1000)",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<? LIMIT 1000)",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM auth_tokens WHERE token_hash IN (SELECT token_hash FROM auth_tokens WHERE expires_at<? LIMIT 1000)",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM hint_requests WHERE rowid IN (SELECT rowid FROM hint_requests WHERE updated_at<? LIMIT 1000)",
    ).bind(now - 86400000),
  ]);
}
export function secureResponse(response: Response) {
  const h = new Headers(response.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  h.set("Strict-Transport-Security", "max-age=31536000");
  h.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: h,
  });
}
export function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export function local(env: Env) {
  return (
    env.LOCAL_DEV === "true" &&
    ["localhost", "127.0.0.1"].includes(new URL(env.APP_ORIGIN).hostname)
  );
}
export function cookie(req: Request, name: string) {
  return req.headers
    .get("Cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + "="))
    ?.slice(name.length + 1);
}
export const sessionCookie = (value: string, env: Env, age = 30 * 86400) =>
  `quest_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${env.APP_ORIGIN.startsWith("https:") ? "; Secure" : ""}`;
export async function seal(apiKey: string, env: Env) {
  if (!env.ENCRYPTION_KEY)
    fail(503, "AIキーの保存用暗号鍵を運営側で設定してください。");
  const raw = unb64(env.ENCRYPTION_KEY!);
  if (raw.length !== 32) fail(503, "保存用暗号鍵の設定が不正です。");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return {
    ciphertext: b64(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(apiKey),
      ),
    ),
    iv: b64(iv),
  };
}
export async function open(ciphertext: string, iv: string, env: Env) {
  if (!env.ENCRYPTION_KEY) fail(503, "暗号鍵が未設定です。");
  const key = await crypto.subtle.importKey(
    "raw",
    unb64(env.ENCRYPTION_KEY!),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv) },
      key,
      unb64(ciphertext),
    ),
  );
}
export function validateBase(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    fail(400, "接続先URLを確認してください。");
  }
  if (
    u!.protocol !== "https:" ||
    u!.username ||
    u!.password ||
    u!.search ||
    u!.hash ||
    (u!.port && u!.port !== "443")
  )
    fail(400, "接続先は資格情報やクエリを含まないHTTPSのURLにしてください。");
  const host = u!.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost") ||
    host.includes(":") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host === "metadata.google.internal"
  )
    fail(400, "公開LLMサービスのホスト名を指定してください。");
  return u!.toString().replace(/\/$/, "");
}
export async function rate(env: Env, key: string, max = 10) {
  const now = Date.now(),
    bucket = Math.floor(now / 600000);
  const k = `${key}:${bucket}`;
  await env.DB.prepare(
    "DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at<? LIMIT 100)",
  )
    .bind(now)
    .run();
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(k, now + 600000)
    .first<{ count: number }>();
  if ((row?.count ?? 0) > max)
    fail(429, "操作が多すぎます。少し待ってから試してください。");
}
export async function mail(
  env: Env,
  email: string,
  link: string,
  kind: string,
) {
  if (local(env)) return link;
  if (!env.RESEND_API_KEY || !env.MAIL_FROM)
    fail(503, "確認メールの配信が未設定です。");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [email],
      subject:
        kind === "verify" ? "QUEST メール確認" : "QUEST パスワード再設定",
      text: `次のリンクから手続きを完了してください。\n${link}\n心当たりがなければ無視してください。`,
    }),
  });
  if (!r.ok)
    fail(503, "メールを送信できませんでした。時間をおいて試してください。");
  return undefined;
}
