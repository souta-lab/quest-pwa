import { test } from "node:test";
import assert from "node:assert/strict";
import {
  password,
  accountPassword,
  checkPassword,
  equal,
  seal,
  open,
  validateBase,
  local,
  type Env,
} from "../worker/security";
test("salted password hashes validate without storing plaintext", async () => {
  const p = await password("strong-password");
  assert.ok(!p.includes("strong-password"));
  assert.ok(await checkPassword("strong-password", p));
  assert.ok(!(await checkPassword("wrong-password", p)));
});
test("account hashes require the separate server secret and random salts", async () => {
  const env = { ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") } as Env;
  const stored = await accountPassword("strong-password", env);
  assert.match(stored, /^pbkdf2-sha256-hmac-v1\$100000\$/);
  assert.equal(await checkPassword("strong-password", stored, env), true);
  assert.equal(await checkPassword("wrong-password", stored, env), false);
  assert.equal(
    await checkPassword("strong-password", stored, {
      ...env,
      ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
    }),
    false,
  );
  assert.notEqual(stored, await accountPassword("strong-password", env));
  await assert.rejects(checkPassword("strong-password", stored));
});
test("BYOK encrypt/decrypt roundtrip and wrong key fails", async () => {
  const env = {
    ENCRYPTION_KEY: btoa("12345678901234567890123456789012"),
  } as Env;
  const encrypted = await seal("sk-private-test", env);
  assert.ok(!encrypted.ciphertext.includes("sk-private"));
  assert.equal(
    await open(encrypted.ciphertext, encrypted.iv, env),
    "sk-private-test",
  );
  await assert.rejects(
    open(encrypted.ciphertext, encrypted.iv, {
      ...env,
      ENCRYPTION_KEY: btoa("98765432109876543210987654321098"),
    }),
  );
});
test("BYOK targets reject local addresses, embedded credentials and insecure transport", () => {
  for (const url of [
    "http://api.example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://test.local",
    "https://user:pass@api.example.com",
    "https://api.example.com?token=x",
  ])
    assert.throws(() => validateBase(url));
  assert.equal(
    validateBase("https://api.example.com/v1/"),
    "https://api.example.com/v1",
  );
});
test("development account links cannot activate on public origin", () => {
  assert.equal(
    local({ APP_ORIGIN: "https://example.com", LOCAL_DEV: "true" } as Env),
    false,
  );
  assert.equal(
    local({ APP_ORIGIN: "http://localhost:8787", LOCAL_DEV: "true" } as Env),
    true,
  );
});
