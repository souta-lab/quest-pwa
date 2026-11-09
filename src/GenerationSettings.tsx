import { useEffect, useState } from "react";
import { Sparkles, Save } from "lucide-react";
import { api } from "./api";
export type GenerationStatus = {
  enabled: boolean;
  available: boolean;
  dailyLimit: null;
  unlimited: true;
  verificationModel: string;
  used: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usageIncomplete: boolean;
  buffer?: { target: number; ready: number; pending: number; failed: number };
  plan: {
    id: string;
    state: string;
    subject: string;
    topic: string;
    error: string | null;
    source: string;
  } | null;
};
export function GenerationSettings({
  busy,
  perform,
  onSaved,
}: {
  busy: boolean;
  perform: (fn: () => Promise<void>) => void;
  onSaved: (s: GenerationStatus) => Promise<void>;
}) {
  const [status, setStatus] = useState<GenerationStatus | null>(null),
    [enabled, setEnabled] = useState(false),
    [model, setModel] = useState(""),
    [providerConfigured, setProviderConfigured] = useState(false),
    [loadError, setLoadError] = useState("");
  useEffect(() => {
    let alive = true;
    void Promise.all([api<GenerationStatus>("/generation"), api("/provider")])
      .then(([s, p]) => {
        if (!alive) return;
        setStatus(s);
        setProviderConfigured(!!p.config);
        setEnabled(s.enabled);
        setModel(s.verificationModel || p.config?.model || "");
      })
      .catch((e) => {
        if (alive) setLoadError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <section className="card generation-settings">
      <div className="section-title">
        <h3>
          <Sparkles size={20} /> AIで新問をつくる
        </h3>
        <span className="pill subtle">BYOK</span>
      </div>
      <p>
        基礎・自力での正解・復習期限・配点から、次の単元と難しさを選択。足りない新問をオリジナル4択で作成し、最大5問を準備します。復習は保存済みの問題を使います。
      </p>
      {loadError && <p role="alert">{loadError}</p>}
      {status && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            perform(async () => {
              const updated = await api<GenerationStatus>(
                "/generation/config",
                { enabled, verificationModel: model },
              );
              setStatus(updated);
              await onSaved(updated);
            });
          }}
        >
          <label className="generation-toggle">
            <span>その場で新問を作る</span>
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              disabled={!status.available || !providerConfigured}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </label>
          {!status.available && (
            <p className="muted">
              新問生成の接続が運営側で未設定です。APIキーの保存状態とは別の設定です。
            </p>
          )}
          {!providerConfigured && (
            <p className="muted">
              上の接続設定にAPIキーを入力して保存してください。
            </p>
          )}
          {providerConfigured && !status.enabled && (
            <p className="notice">
              APIキーは保存済みです。現在は保存済み問題だけを出題しています。新問を作るには、この設定を有効にして保存してください。
            </p>
          )}
          <div className="generation-fields">
            <label>
              検証モデル
              <input
                value={model}
                maxLength={150}
                required={enabled}
                onChange={(e) => setModel(e.target.value)}
                placeholder="同じ接続先で使えるモデル名"
              />
            </label>
          </div>
          <small>
            生成には上のBYOKモデルを使います。検証モデルは別呼び出しで問題を解き直します。作問には科目に合わせた10問のオリジナル見本を渡します。
          </small>
          <p className="generation-cost">
            新問1問につき原則2回、形式修復が必要なときは最大3回のAPI呼び出し。失敗した作問にも料金が発生する場合があります。1日の生成件数は無制限です。先読みは最大5問。使った分を順次補充します。始めた5問の準備は、終了後も続く場合があります。
          </p>
          <p className="muted">
            今日の生成 {status.used}問 · 上限なし（失敗を含む）。
            {status.inputTokens !== null && status.outputTokens !== null
              ? `計測済み ${status.inputTokens + status.outputTokens} tokens。`
              : ""}
            {status.usageIncomplete ? "一部の使用量は計測できていません。" : ""}
          </p>
          <p className="muted">
            AIチェックを通しても誤りは残ります。生成問題は保存し、運営の承認後にみんなが利用できます。報告した問題はあなたへの出題から外し、運営が確認します。学力レートは未校正です。
          </p>
          <button className="button primary" disabled={busy} type="submit">
            <Save size={18} />
            生成設定を保存
          </button>
        </form>
      )}
    </section>
  );
}
