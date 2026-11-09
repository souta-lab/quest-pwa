// D1 migrations are applied with: cf d1 migrations apply <id> --dir migrations
import { bindings, defineConfig, triggers } from "cf/config";

/**
 * Secret-like files were detected but not read or migrated: .dev.vars.example. Only `secrets.required` entries are migrated.
 * @see https://developers.cloudflare.com/workers/configuration/secrets/
 */

export default defineConfig({
  accountId: "73e4fc6c7371ac0eae00a53fbf21c86d",
  worker: {
    name: "quest-pwa",
    domains: ["common-test.s0u7a.f5.si"],
    workersDev: false,
    previewUrls: false,
    compatibilityDate: "2026-10-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "worker/index.ts",
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
    triggers: [
      triggers.scheduled({ schedule: "0 * * * *" }),
      triggers.queue({
        maxBatchSize: 1,
        maxBatchTimeout: 1,
        maxConcurrency: 3,
        maxRetries: 0,
        name: "quest-generation",
      }),
    ],
    env: {
      ENCRYPTION_KEY: bindings.secret(),
      RESEND_API_KEY: bindings.secret(),
      MAIL_FROM: bindings.text("QUEST <noreply@common-test.s0u7a.f5.si>"),
      APP_ORIGIN: bindings.text("https://common-test.s0u7a.f5.si"),
      DB: bindings.d1({
        name: "quest-pwa",
        id: "f8ce7651-89f2-44fe-9ac9-a6d96a5e81ff",
      }),
      GENERATION_QUEUE: bindings.queue({
        name: "quest-generation",
      }),
      ASSETS: bindings.assets(),
    },
  },
});
