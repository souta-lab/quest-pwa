import { topics } from "./curriculum";
import type { Env } from "./security";

// Rows align with each subject's curriculum. The targets stay server-side:
// a concept label can itself be the answer to a knowledge question.
const targets: Record<string, string[]> = {
  japanese: [
    "文脈による語義|類義語の使い分け|対義語と意味の範囲|比喩の意味",
    "主張と根拠|対比の構造|具体例の役割|条件付きの主張",
    "助動詞の意味|敬語の方向|係り結び|助詞と文脈",
    "多義語の文脈判断|心情を表す語|現代語と異なる語義|動作を表す語",
    "否定と二重否定|使役と受身|反語と疑問|再読文字",
  ],
  math1: [
    "展開と因数分解|絶対値と不等式|根号の計算|実数と式の値",
    "必要十分条件|集合の包含|対偶と反例|ド・モルガンの法則",
    "定義域と最大最小|グラフの平行移動|二次不等式|二次関数の決定",
    "正弦定理|余弦定理|三角形の面積|三角比の相互関係",
    "分散と標準偏差|相関と因果|箱ひげ図|データの線形変換",
    "条件付き確率|独立な試行|場合分けと余事象|順列と組合せ",
    "三角形の重心と内心|円周角と接線|相似と辺の比|空間の直線と平面",
  ],
  math2: [
    "加法定理|周期とグラフ|三角方程式|弧度法と角度",
    "対数の定義|対数の性質|指数方程式|指数関数の増減",
    "接線の方程式|導関数と増減|定積分と面積|極値と条件",
    "等差数列|等比数列|漸化式|数列の和",
    "期待値と分散|正規分布|標本平均|信頼区間",
    "内積と角度|位置ベクトル|直線と比|空間ベクトル",
    "極形式と回転|複素数の積|絶対値と距離|共役複素数",
    "恒等式の係数比較|二項定理|相加相乗平均|等式と不等式の証明",
    "解と係数の関係|剰余の定理|高次方程式の因数|虚数単位の計算",
    "直線の平行と垂直|円の方程式|軌跡|領域と不等式",
  ],
  english: [
    "文脈に合う動詞|接頭辞と語義|言い換え|語の結びつき",
    "段落の中心文|筆者の意見と事実|要約|文章の目的",
    "指示語の対象|逆接と因果|具体例と一般論|時系列の接続",
    "案内文の条件|メールの意図|意見の比較|数値資料と英文",
  ],
  information: [
    "個人情報と同意|著作権の基本|情報の信頼性|アクセシビリティ",
    "二進数|画像のデータ量|標本化と量子化|情報圧縮",
    "変数と代入|反復と条件分岐|配列の添字|探索と計算量",
    "IPとDNS|パケット通信|認証と暗号化|ネットワーク構成",
    "散布図の読み取り|欠損と外れ値|モデルとシミュレーション|データの尺度",
  ],
  biology: [
    "酵素の働き|細胞膜と輸送|呼吸とATP|光合成",
    "DNAの複製|転写と翻訳|遺伝子発現の調節|遺伝子と突然変異",
    "減数分裂|受精と染色体|発生の誘導|遺伝と組換え",
    "神経とシナプス|ホルモンの調節|動物の行動|植物の光応答",
    "個体群の増加|種間関係|物質循環|生物多様性",
    "自然選択|遺伝的浮動|系統樹|種分化",
  ],
  chemistry: [
    "原子と同位体|電子配置|周期表の傾向|混合物の分離",
    "イオン結合|共有結合と分子の形|分子間力|結晶の性質",
    "モルと粒子数|濃度と溶液|反応量の比|気体の体積",
    "酸塩基と中和|酸化還元|化学平衡|反応速度",
    "気体の発生と性質|金属イオンの反応|典型元素|金属の製錬",
    "異性体|官能基の性質|芳香族化合物|有機化合物の反応",
    "付加重合と縮合重合|糖と多糖|タンパク質|高分子の性質",
  ],
  physics: [
    "運動のグラフ|運動方程式|力学的エネルギー|運動量と衝突",
    "熱量と比熱|熱力学第一法則|気体の状態変化|分子運動",
    "波の重ね合わせ|定常波|屈折と干渉|ドップラー効果",
    "電場と電位|コンデンサー|直流回路|電磁誘導",
    "光電効果|原子のエネルギー準位|放射性崩壊|核反応と質量欠損",
  ],
  earth: [
    "プレート運動|地震波と内部構造|重力と地球|火山活動",
    "火成岩と鉱物|堆積構造|地層の対比|地質年代",
    "大気の安定性|気圧と風|海流と熱輸送|気象前線",
    "恒星の進化|天体の距離|太陽系|宇宙の膨張",
  ],
  basicScience: [
    "細胞と代謝|遺伝情報|体内環境と免疫|植生と生態系",
    "原子と周期表|物質量と濃度|酸塩基と中和|酸化還元",
    "力と運動|仕事とエネルギー|熱と温度|波と電気の基礎",
    "地球内部と地震|地層と地球史|大気と海洋|宇宙と地球",
  ],
  japanHistory: [
    "律令国家|土地制度|古代の対外関係|古代文化の比較",
    "武家政権|荘園と村落|中世の交易|宗教と文化",
    "幕藩体制|農業と流通|身分と都市|対外政策の変化",
    "明治の制度改革|立憲体制|産業化と社会|近代の対外関係",
    "政党政治|戦争と暮らし|戦後改革|高度経済成長",
  ],
  worldHistory: [
    "河川文明|古代帝国の統治|地中海世界|宗教の成立",
    "陸と海の交易|イスラーム世界|東アジアの交流|モンゴル帝国",
    "大航海時代|宗教改革|近世アジアの国家|世界経済の形成",
    "市民革命|産業革命|国民国家|帝国主義",
    "世界大戦|冷戦|脱植民地化|国際協調",
  ],
  geography: [
    "縮尺と距離|等高線|地図投影法|GISと資料",
    "気候の成因|地形と営力|自然災害|植生と土壌",
    "農業の立地|工業の立地|資源とエネルギー|貿易と物流",
    "人口転換|人口移動|都市構造|都市と地域格差",
    "地域の気候と産業|文化と生活|地域間の結びつき|地域資料の比較",
  ],
  ethics: [
    "アイデンティティ|欲求と発達|自己と他者|青年期の課題",
    "古代ギリシア思想|近代の認識論|義務と功利|実存と現象学",
    "儒家と道家|仏教の基本|中国思想の比較|宗教と生き方",
    "古代日本の思想|日本の仏教|近世の学問|近代日本の思想",
    "生命倫理|環境倫理|情報社会の倫理|公正と責任",
  ],
  politics: [
    "権力分立|選挙と代表|世論と政治参加|地方自治",
    "基本的人権|国会と内閣|裁判所と違憲審査|平和主義",
    "需要供給|金融と物価|財政と税|労働と社会保障",
    "国際連合|安全保障|国際貿易|為替と国際収支",
  ],
};
export const approaches = [
  "概念の比較",
  "具体例への適用",
  "短い資料の読解",
  "条件を変えた推論",
  "誤った説明の発見",
  "理由・因果の判断",
  "結果から条件の逆算",
  "複数条件の照合",
  "手順・説明の穴埋め",
  "例外・反例の選択",
];
export const scenarios = [
  "教科書の簡潔な設定",
  "学習者二人の短い会話",
  "オリジナルの資料・表",
  "日常や社会の小さな場面",
  "予想と結果の比較",
  "条件の異なる二つのケース",
  "途中の説明・答案の検討",
  "手順やルールを整理したメモ",
];
const subjectScenarios: Record<string, string[]> = {
  mathematics: [
    "短い式・関数と条件",
    "日常の数量の比較",
    "数値の表・測定記録",
    "学習者の途中計算",
    "条件の異なる二つのケース",
    "規則と手順のメモ",
    "座標や位置を文章で示す場面",
    "予想と反例を比較する場面",
  ],
  english: [
    "短いメールのやり取り",
    "案内・募集要項",
    "レビューと評価表",
    "予定表・変更通知",
    "意見の異なる二人の文章",
    "短い記事と読者コメント",
    "手順書・利用上の注意",
    "数値表と説明文",
  ],
  science: [
    "対照実験の記録",
    "観測結果の数値表",
    "誤りを含む実験メモ",
    "条件の異なる二つの試料",
    "予想と結果の比較",
    "身近な現象のモデル",
    "装置と操作を文章で説明した場面",
    "追加実験の計画",
  ],
  humanities: [
    "短い資料と解説",
    "立場の違う二人の記録",
    "時系列の整理表",
    "地域や時代の比較表",
    "制度と暮らしの事例",
    "資料の作成目的を考える場面",
    "主張と根拠を照合する場面",
    "説明の誤りを検討する場面",
  ],
};
export function scenarioChoices(subject: string) {
  return subject.startsWith("math")
    ? subjectScenarios.mathematics
    : subject === "english"
      ? subjectScenarios.english
      : ["biology", "chemistry", "physics", "earth", "basicScience"].includes(
            subject,
          )
        ? subjectScenarios.science
        : [
              "japanHistory",
              "worldHistory",
              "geography",
              "ethics",
              "politics",
            ].includes(subject)
          ? subjectScenarios.humanities
          : scenarios;
}
export function focusChoices(subject: string, topic: string) {
  const additions: Record<string, string> = {
    文学的文章の読解:
      "叙述と心情の変化|語り手と視点|比喩と表現効果|場面と人物関係",
    実用的な文章の読解:
      "複数資料の比較|目的と条件の整理|図表と文章の対応|情報の優先順位",
    歴史総合:
      "近代化と社会の変化|国際秩序と大衆化|グローバル化|資料の比較と因果関係",
    公共の基本原理: "個人の尊厳と平等|合意形成と対話|幸福と公正|持続可能な社会",
  };
  if (additions[topic]) return additions[topic].split("|");
  const index = topics[subject]?.indexOf(topic) ?? -1;
  return index < 0
    ? []
    : (targets[subject]?.[index] ?? "").split("|").filter(Boolean);
}
export type QuestionBrief = {
  focus: string;
  approach: string;
  scenario: string;
};
export async function chooseBrief(
  env: Env,
  id: string,
  subject: string,
  topic: string,
  random = Math.random,
  focusOverride?: string,
): Promise<QuestionBrief> {
  const rows = await env.DB.prepare(
    "SELECT subject,topic,focus,approach,scenario FROM generation_plans WHERE user_id=? AND source='generated' AND state IN ('used','ready','pending') ORDER BY rowid DESC LIMIT 160",
  )
    .bind(id)
    .all<QuestionBrief & { subject: string; topic: string }>();
  const scoped = rows.results.filter(
    (r) => r.subject === subject && r.topic === topic,
  );
  const candidates = (
    field: keyof QuestionBrief,
    options: string[],
    history: QuestionBrief[],
  ) => {
    const seen = history.map((r) => r[field]).filter(Boolean);
    // Do not immediately return to either of the last two concepts. For formats
    // and contexts one previous value is enough; exhausted bags refill safely.
    const cooling = new Set(seen.slice(0, field === "focus" ? 2 : 1));
    const eligible = options.filter((o) => !cooling.has(o));
    const bag = eligible.length ? eligible : options;
    const counts = new Map(
      bag.map((o) => [o, seen.filter((s) => s === o).length]),
    );
    const least = Math.min(...counts.values());
    return bag.filter((o) => counts.get(o) === least);
  };
  const focuses = focusOverride
    ? [focusOverride]
    : focusChoices(subject, topic);
  const fs = candidates("focus", focuses.length ? focuses : [topic], scoped);
  const as = candidates("approach", approaches, rows.results);
  const ss = candidates("scenario", scenarioChoices(subject), rows.results);
  const recipes = fs.flatMap((focus) =>
    as.flatMap((approach) =>
      ss.map((scenario) => {
        const exact = scoped.filter(
          (r) =>
            r.focus === focus &&
            r.approach === approach &&
            r.scenario === scenario,
        ).length;
        const pairs = scoped.reduce(
          (n, r) =>
            n +
            Number(r.focus === focus && r.approach === approach) +
            Number(r.focus === focus && r.scenario === scenario) +
            Number(r.approach === approach && r.scenario === scenario),
          0,
        );
        return {
          brief: { focus, approach, scenario },
          score: exact * 1000 + pairs * 10 + Math.max(0, Math.min(1, random())),
        };
      }),
    ),
  );
  recipes.sort((a, b) => a.score - b.score);
  return recipes[0].brief;
}
export function isNumberVariant(a: string, b: string) {
  const normalize = (s: string) =>
    s
      .normalize("NFKC")
      .replace(/\s+/g, "")
      .replace(/(?<![a-zA-Z])[a-z](?![a-zA-Z])/g, "@")
      // Preserve operators: asking for a sum and a difference are distinct tasks.
      .replace(/\d+(?:\.\d+)?/g, "#");
  return (
    a !== b &&
    (a.match(/\d+(?:\.\d+)?/g)?.length ?? 0) >= 2 &&
    (b.match(/\d+(?:\.\d+)?/g)?.length ?? 0) >= 2 &&
    normalize(a).length >= 20 &&
    normalize(a) === normalize(b)
  );
}
