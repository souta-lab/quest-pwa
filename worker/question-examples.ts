import type { Question } from "./bank";

type ExampleQuestion = Pick<
  Question,
  | "subject"
  | "topic"
  | "stem"
  | "options"
  | "correct"
  | "explanation"
  | "hints"
  | "difficulty"
  | "expectedSeconds"
  | "basicRange"
>;
export type QuestionExample = {
  key: string;
  focus: string;
  question: ExampleQuestion;
};
const options = (...texts: [string, string, string, string]) =>
  texts.map((text, i) => ({ id: "abcd"[i], text }));

// Original editorial examples, never added to the question pool or shown as new questions.
// Facts needed for unfamiliar or fictional settings are supplied in the stem.
export const questionExamples: QuestionExample[] = [
  {
    key: "absolute-distance",
    focus: "距離の定義から範囲を読み、端点と中心の誤りを分ける",
    question: {
      subject: "math1",
      topic: "数と式",
      difficulty: 1,
      expectedSeconds: 60,
      stem: "数直線上で $|x-2|$ は $x$ と2の距離を表す。$|x-2|<3$ を満たす $x$ の範囲はどれか。",
      options: options(
        "$-3<x<3$",
        "$-1<x<5$",
        "$-1\\le x\\le5$",
        "$x<-1$ または $x>5$",
      ),
      correct: "b",
      explanation:
        "中心は2、距離は3未満なので、左端は2-3=-1、右端は2+3=5。端点では距離がちょうど3になり含まれない。中心を0とした範囲、端点を含む範囲、区間の外側という誤りを区別する。",
      hints: ["中心を2に置き、左右へ同じ距離だけ進んだ位置を考えよう。"],
    },
  },
  {
    key: "necessary-counterexample",
    focus: "逆向きの命題を反例で調べ、必要条件と十分条件を区別する",
    question: {
      subject: "math1",
      topic: "集合と命題",
      difficulty: 1,
      expectedSeconds: 60,
      stem: "整数 $n$ について、$P$ を「$n$ は4の倍数」、$Q$ を「$n$ は偶数」とする。$P$ と $Q$ の関係として正しいものはどれか。",
      options: options(
        "$P$ は $Q$ の必要十分条件",
        "$P$ は $Q$ の必要条件だが十分条件ではない",
        "$P$ は $Q$ の十分条件だが必要条件ではない",
        "$P$ は $Q$ の必要条件でも十分条件でもない",
      ),
      correct: "c",
      explanation:
        "4の倍数は必ず偶数なのでPならばQ。しかしn=2は偶数で4の倍数ではなく、QならばPは成り立たない。したがってPだけでQが保証される十分条件であり、Qが成立するためにPが必須という必要条件ではない。",
      hints: ["一方の条件を満たすが、もう一方は満たさない整数を探してみよう。"],
    },
  },
  {
    key: "variance-transform",
    focus: "データ変換を、平均の移動とばらつきの倍率に分ける",
    question: {
      subject: "math1",
      topic: "データの分析",
      difficulty: 2,
      expectedSeconds: 75,
      stem: "データ $x_1,\\ldots,x_n$ の平均は5、分散は9である。各値を $y_i=4x_i+3$ に変換した。新しいデータの平均と分散の組はどれか。",
      options: options(
        "平均23・分散144",
        "平均23・分散39",
        "平均8・分散12",
        "平均20・分散36",
      ),
      correct: "a",
      explanation:
        "平均は各値と同様に4倍して3を加えるので23。平均からの偏差は4倍になり、分散は偏差の二乗の平均だから16倍の144になる。全値への3の加算は分散を変えない。39は分散に4倍と3の加算を適用した誤り、平均8は4倍を落とした誤り、平均20は3の加算を落としている。",
      hints: ["全員に同じ数を足す操作が、平均との差を変えるかを考えよう。"],
    },
  },
  {
    key: "cosine-explanation",
    focus: "公式を与え、途中の代入で何を引くべきかを判断させる",
    question: {
      subject: "math1",
      topic: "図形と計量",
      difficulty: 1,
      expectedSeconds: 75,
      stem: "三角形の二辺の長さが3と4、その間の角が $60^\\circ$ である。残りの辺を $c$ とする。余弦定理は $c^2=a^2+b^2-2ab\\cos C$、また $\\cos60^\\circ=1/2$ である。$c$ として正しいものはどれか。",
      options: options("7", "$\\sqrt7$", "5", "$\\sqrt{13}$"),
      correct: "d",
      explanation:
        "与えられた値を代入するとcの二乗は9+16-2×3×4×1/2=13。辺の長さは正なのでc=√13。7は辺を単純に足した誤り、5は直角三角形と誤解した値。√7では二乗しても13にならず、余弦の項の計算が合わない。",
      hints: ["二辺の間の角を使い、二乗の式の各項へ一つずつ代入しよう。"],
    },
  },
  {
    key: "reading-time-constraints",
    focus: "短い案内と予定を照合し、開始時刻と受付期限を区別する",
    question: {
      subject: "english",
      topic: "短い英文の読解",
      difficulty: 2,
      expectedSeconds: 75,
      stem: "次の案内を読む。\nThe art workshop starts at 10 a.m. and again at 11 a.m. Please sign in at least ten minutes before your workshop starts. If you are late, choose a later session.\nAyaは午前9時55分に受付へ着いた。案内に従うと、どの回に参加できるか。",
      options: options(
        "10時の回だけ",
        "11時の回だけ",
        "10時と11時のどちらも選べる",
        "どちらの回にも参加できない",
      ),
      correct: "b",
      explanation:
        "10時の回の受付期限は9時50分なので、9時55分では間に合わない。11時の回の期限は10時50分で、到着時刻はその前に当たる。開始時刻そのものと受付期限を区別し、at least ten minutes beforeを10分以上前と読む。",
      hints: ["それぞれの開始時刻から、受付が終わる時刻を別々に求めよう。"],
    },
  },
  {
    key: "enzyme-controlled-comparison",
    focus: "一つの条件だけが違う比較を選び、実験の因果を読み取る",
    question: {
      subject: "biology",
      topic: "細胞と分子",
      difficulty: 1,
      expectedSeconds: 75,
      stem: "タンパク質分解酵素の有無の影響を調べたい。次の3条件で、同じ量の基質を同じ時間だけ反応させた。\n\n| 条件 | 酵素 | 温度 |\n|---|---|---|\n| Ⅰ | あり | 37℃ |\n| Ⅱ | なし | 37℃ |\n| Ⅲ | あり | 5℃ |\n\n酵素の有無だけの影響を調べる比較はどれか。",
      options: options(
        "条件Ⅰと条件Ⅱ",
        "条件Ⅰと条件Ⅲ",
        "条件Ⅱと条件Ⅲ",
        "どの2条件を比べても同じである",
      ),
      correct: "a",
      explanation:
        "ⅠとⅡは温度が同じで酵素の有無だけが異なる。ⅠとⅢは酵素を両方含むため温度の影響の比較である。ⅡとⅢは温度と酵素の有無が同時に変わり、結果の違いをどちらの原因へ帰属するか分けられない。変えたい条件以外を揃えるのが対照実験の基本である。",
      hints: ["比較したい条件以外が同じになっている組を探そう。"],
    },
  },
  {
    key: "quadratic-domain",
    focus: "定義域を明示し、頂点と端点の取り違えを誤答にする",
    question: {
      subject: "math1",
      topic: "二次関数",
      difficulty: 2,
      expectedSeconds: 60,
      stem: "$y=(x-2)^2+1$ について、$0\\le x\\le3$ における最大値と最小値の組として正しいものはどれか。",
      options: options(
        "最大値5、最小値1",
        "最大値2、最小値1",
        "最大値5、最小値2",
        "最大値10、最小値1",
      ),
      correct: "a",
      explanation:
        "頂点は(2,1)で定義域内なので最小値は1。端点ではx=0のとき5、x=3のとき2なので最大値は5。最大値2は右端だけを調べた誤り、最小値2は頂点を除いた誤り。最大値10は定義域外のx=5を代入した値。",
      hints: [
        "上に開く放物線です。頂点が定義域内にあるかを確認し、両端の値も比べよう。",
      ],
    },
  },
  {
    key: "without-replacement",
    focus: "同様に確からしい標本を指定し、復元抽出との混同を扱う",
    question: {
      subject: "math1",
      topic: "場合の数と確率",
      difficulty: 2,
      expectedSeconds: 75,
      stem: "赤玉3個と白玉2個の計5個から、異なる2個を同時に取り出す。どの2個の組も同様に確からしい。赤玉と白玉が1個ずつになる確率はどれか。",
      options: options(
        "$\\frac{12}{25}$",
        "$\\frac{3}{10}$",
        "$\\frac35$",
        "$\\frac25$",
      ),
      correct: "c",
      explanation:
        "全体は5個から2個を選ぶ10通り。赤1個の選び方3通りと白1個の選び方2通りを掛けると6通りなので6/10=3/5。12/25は戻して2回引く場合、3/10は順序で数えた分母20に順序を数えない分子6を使う誤り。2/5は同じ色の2個を取り出す確率です。",
      hints: [
        "玉を戻す操作はありません。色だけでなく、5個の玉を区別して2個の組を数えよう。",
      ],
    },
  },
  {
    key: "cubic-extrema",
    focus: "計算結果だけでなく増減と端点を確認する",
    question: {
      subject: "math2",
      topic: "微分と積分",
      difficulty: 3,
      expectedSeconds: 150,
      stem: "$f(x)=x^3-3x$ の $-2\\le x\\le2$ における最大値と、その値をとるすべての $x$ の組はどれか。",
      options: options(
        "最大値2、x=2のみ",
        "最大値2、x=-1とx=2",
        "最大値-2、x=1のみ",
        "最大値6、x=-2とx=2",
      ),
      correct: "b",
      explanation:
        "f'(x)=3(x-1)(x+1)より、増減の切り替わる候補はx=-1,1。端点も含めてf(-2)=-2、f(-1)=2、f(1)=-2、f(2)=2なので、最大値2をx=-1と2でとる。x=2のみは区間内部の極大を見落とし、-2は最小値との混同。6はこれらの関数値と一致しない。",
      hints: [
        "閉区間での最大値は、端点だけでなく区間内部の極値でもとり得ます。導関数が0になる点を候補に加えよう。",
      ],
    },
  },
  {
    key: "reading-exception",
    focus: "文法穴埋めではなく、短い案内の例外条件を読み取る",
    question: {
      subject: "english",
      topic: "短い英文の読解",
      difficulty: 2,
      expectedSeconds: 60,
      stem: "次の案内を読み、問いに答えよ。\nThe school library and its study rooms normally close at 5 p.m. On Friday, the library will stay open until 7 p.m., but the study rooms will close at their usual time.\n金曜日の午後6時にできることとして、案内の内容に合うものはどれか。",
      options: options(
        "図書館も学習室も利用できる",
        "学習室だけ利用できる",
        "図書館も学習室も利用できない",
        "図書館は利用できるが、学習室は利用できない",
      ),
      correct: "d",
      explanation:
        "図書館は金曜日に限って午後7時まで開きます。一方、butの後の学習室はusual time、つまり通常の午後5時に閉まります。午後6時には図書館だけ利用できます。延長を学習室にも適用したり、図書館にも通常時刻を適用したりしないことが要点です。",
      hints: [
        "butは、それまでの説明に条件や例外を加えることがあります。libraryとstudy roomsの閉まる時刻を別々に整理しよう。",
      ],
    },
  },
  {
    key: "reading-causality",
    focus: "相関から因果へ飛躍しない、本文だけで判定する読解",
    question: {
      subject: "japanese",
      topic: "論理的文章の読解",
      difficulty: 2,
      expectedSeconds: 60,
      stem: "次の文章の主張に最も合うものを選べ。\n「朝に読書をする生徒ほど、あるテストの点が高かった。しかし、この結果だけでは読書が点を上げたとは言えない。学習時間など、別の条件が両方に関係した可能性もある。」",
      options: options(
        "朝の読書には点を上げる効果が一切ない",
        "学習時間が点を決める唯一の要因である",
        "観察された関係だけでは、読書が原因だと断定できない",
        "点が高い生徒は必ず朝に読書をしている",
      ),
      correct: "c",
      explanation:
        "本文は二つの事柄に関係が見られても、それだけで因果関係を断定できないと述べています。効果がないと断定してはいません。学習時間は別の条件の一例で、唯一の要因という意味でもありません。また「ほど」は傾向を述べる表現で、全員についての必然を示しません。",
      hints: [
        "「断定できない」と「効果がない」は違います。本文が主張をどの強さまで述べているかに注目しよう。",
      ],
    },
  },
  {
    key: "algorithm-boundary",
    focus: "変数の役割と境界条件の典型的な誤りを区別する",
    question: {
      subject: "information",
      topic: "アルゴリズムとプログラミング",
      difficulty: 2,
      expectedSeconds: 60,
      stem: "配列A=[2,5,5,8]に対して次の手順を実行する。変数countの初期値は0とする。\nAの各要素xについて、x>5ならcountに1を加える。\n終了後のcountの値はどれか。",
      options: options("1", "3", "8", "20"),
      correct: "a",
      explanation:
        "条件x>5を満たす要素は8だけなので、加算は1回。5を含めて数えると3になるが、不等号は>=ではありません。8は条件を満たす要素の値、20は配列の全要素の和であり、要素の個数を数えるcountとは異なります。",
      hints: [
        "countに加えるのはxの値ではなく1です。また、ちょうど5の要素が条件を満たすかを確認しよう。",
      ],
    },
  },
  {
    key: "enzyme-control",
    focus: "対照と温度を戻した条件を比較し、資料以上の断定を避ける",
    question: {
      subject: "biology",
      topic: "細胞と分子",
      difficulty: 2,
      expectedSeconds: 90,
      stem: "同じ酵素液を2本用意した。Aは25℃、Bは80℃で5分間保ち、両方を25℃に戻してから同量・同濃度の基質を加えた。他の条件は同じである。1分間の生成物量はAで10、Bで0だった。この結果から直接言えることはどれか。",
      options: options(
        "酵素が最もよく働く温度は必ず25℃である",
        "この条件では、80℃の処理後に25℃へ戻しても元の活性は確認できなかった",
        "80℃では、すべての化学反応が停止する",
        "AとBでは加えた基質量が異なる",
      ),
      correct: "b",
      explanation:
        "反応時の温度と基質条件をそろえてもBは生成物を生じていません。この実験では高温処理後に活性が戻ることは確認できません。高温で酵素の立体構造が変化することと整合的ですが、測定点が二つだけなので最適温度までは決められません。全反応への一般化もできず、基質量は同じと指定されています。",
      hints: [
        "高温で処理しているときの反応と、25℃に戻した後の反応を区別しよう。実際に測定したのはどちらだろう。",
      ],
    },
  },
  {
    key: "neutralization-units",
    focus: "反応比とmol/L・mLの関係を明示し、暗算で解ける計算にする",
    question: {
      subject: "chemistry",
      topic: "物質量",
      difficulty: 2,
      expectedSeconds: 60,
      stem: "$0.100\\,\\mathrm{mol/L}$ の塩酸 $20.0\\,\\mathrm{mL}$ を過不足なく中和するのに必要な、$0.200\\,\\mathrm{mol/L}$ の水酸化ナトリウム水溶液の体積はどれか。反応は $\\mathrm{HCl+NaOH\\rightarrow NaCl+H_2O}$ とする。",
      options: options(
        "$40.0\\,\\mathrm{mL}$",
        "$20.0\\,\\mathrm{mL}$",
        "$10.0\\,\\mathrm{mL}$",
        "$5.00\\,\\mathrm{mL}$",
      ),
      correct: "c",
      explanation:
        "HClは0.100×0.0200=0.00200 mol。反応比が1:1なので必要なNaOHも0.00200 mol。体積は0.00200/0.200=0.0100 L=10.0 mL。40.0 mLは濃度比を逆に扱った値、20.0 mLは濃度差を無視した値。5.00 mLは与えられた1:1の反応比に合いません。",
      hints: [
        "物質量は濃度×体積です。反応式の係数比を確認し、mLをLに直して扱おう。",
      ],
    },
  },
  {
    key: "work-energy",
    focus: "仕事によるエネルギー変化と速さの二乗を結びつける",
    question: {
      subject: "physics",
      topic: "力学",
      difficulty: 2,
      expectedSeconds: 90,
      stem: "質量2.0 kgの物体が水平面上を速さ3.0 m/sで滑っている。運動方向と逆向きの一定の摩擦力5.0 Nが働いたまま1.0 m進んだ。このときの速さはどれか。他に仕事をする力はない。運動エネルギーは $\\frac12mv^2$ とする。",
      options: options("1.0 m/s", "2.0 m/s", "3.0 m/s", "4.0 m/s"),
      correct: "b",
      explanation:
        "初めの運動エネルギーは(1/2)×2.0×3.0²=9.0 J。摩擦の仕事は-5.0×1.0=-5.0 Jなので、残りは4.0 J。質量2.0 kgでは運動エネルギーの数値がv²に等しいためv=2.0 m/s。3.0は摩擦を無視した値、4.0はエネルギーの数値をそのまま速さにした値です。1.0もエネルギー収支に合いません。",
      hints: [
        "運動と逆向きの力の仕事は負になります。速さを直接引くのではなく、まず運動エネルギーの増減を求めよう。",
      ],
    },
  },
  {
    key: "opportunity-cost",
    focus: "架空の数値を使い、絶対優位と比較優位の混同を問う",
    question: {
      subject: "politics",
      topic: "国際政治と経済",
      difficulty: 3,
      expectedSeconds: 120,
      stem: "同じ労働時間で、A国は布4単位または小麦2単位、B国は布3単位または小麦3単位を生産できる。生産量は労働時間に比例し、他の費用はない。機会費用が低い財に比較優位があるとすると、両国の比較優位の組はどれか。",
      options: options(
        "A国は布、B国は小麦",
        "A国は小麦、B国は布",
        "A国は両方、B国はどちらもない",
        "両国とも布",
      ),
      correct: "a",
      explanation:
        "布1単位を増やすために諦める小麦はA国が2/4=0.5、B国が3/3=1単位で、布はA国が低費用。小麦1単位の機会費用はA国が布2、B国が布1単位で、小麦はB国が低費用です。各財の生産量そのものだけで優劣を決めるのは絶対優位との混同です。",
      hints: [
        "布1単位を作る代わりに、各国は小麦を何単位諦めるだろう。同じ財どうしで比べよう。",
      ],
    },
  },
  {
    key: "seismic-evidence",
    focus: "資料から支持される推論と行き過ぎた推論を区別する",
    question: {
      subject: "earth",
      topic: "地球の構造",
      difficulty: 2,
      expectedSeconds: 60,
      stem: "P波は固体と液体を伝わるが真空を伝わらず、S波は固体を伝わるが液体を伝わらない。地震波の観測と分析により、外核をP波は通過するがS波は通過しないとわかった。この性質と観測から支持される外核の状態はどれか。",
      options: options(
        "外核は真空である",
        "外核の温度は0℃である",
        "外核は地殻と同じ固体の岩石である",
        "外核は液体である",
      ),
      correct: "d",
      explanation:
        "地震波の観測とS波の性質から、外核が液体であるという解釈が支持されます。これだけから温度を0℃と決めることはできず、物質が存在しない真空を示すものでもありません。地殻と同じ固体という説明は液体を示す性質と合いません。",
      hints: [
        "波が通過しないという観測を、設問の冒頭で与えられたS波の性質と結びつけよう。",
      ],
    },
  },
  {
    key: "basic-biology-control",
    focus: "理科基礎の範囲指定と、仮説を確かめる対照実験",
    question: {
      subject: "basicScience",
      basicRange: "biology",
      topic: "生物基礎",
      difficulty: 1,
      expectedSeconds: 45,
      stem: "ある植物の発芽に光が必要かを調べたい。同じ種の種子を同数ずつ2群に分け、一方を明るい場所、他方を暗い場所に置く。水分・温度など他の条件はどうするのが適切か。",
      options: options(
        "明るい群だけ水を多くする",
        "暗い群だけ温度を低くする",
        "両群で同じにする",
        "両群で別々の植物種を使う",
      ),
      correct: "c",
      explanation:
        "光の有無による違いを調べるには、比較する2群で光以外の条件をそろえます。水分、温度、植物種まで変えると、発芽の違いが光によるものかを区別できません。結果が出る前から、光が必要だと決めつけないことも大切です。",
      hints: [
        "調べたい要因を一つだけ変え、結果に影響しそうな他の条件をそろえるのが対照実験です。",
      ],
    },
  },
  {
    key: "basic-chemistry-isotope",
    focus: "定義を示し、原子番号・質量数・中性の条件を使い分ける",
    question: {
      subject: "basicScience",
      basicRange: "chemistry",
      topic: "化学基礎",
      difficulty: 1,
      expectedSeconds: 45,
      stem: "原子番号は陽子数、質量数は陽子数と中性子数の和である。原子番号6、質量数14の電気的に中性な原子について、中性子数と電子数の組はどれか。",
      options: options(
        "中性子8、電子6",
        "中性子6、電子8",
        "中性子14、電子6",
        "中性子8、電子14",
      ),
      correct: "a",
      explanation:
        "陽子は6個なので、中性子は14-6=8個。電気的に中性なら正負の電荷が打ち消し合うため、電子数は陽子数と同じ6個です。質量数を中性子数や電子数と直接同一視してはいけません。",
      hints: [
        "まず原子番号から陽子数を決めよう。質量数との差が中性子数で、中性な原子の電子数は陽子数に等しくなります。",
      ],
    },
  },
  {
    key: "basic-physics-speed",
    focus: "平均の速さを時間全体から求め、往復距離を混同しない",
    question: {
      subject: "basicScience",
      basicRange: "physics",
      topic: "物理基礎",
      difficulty: 1,
      expectedSeconds: 45,
      stem: "ある人が東へ60 m進むのに20秒かかり、続けて西へ20 m戻るのに20秒かかった。停止時間はない。全40秒間の平均の速さはどれか。",
      options: options("0 m/s", "1.0 m/s", "3.0 m/s", "2.0 m/s"),
      correct: "d",
      explanation:
        "平均の速さは移動距離の合計を経過時間で割ります。移動距離は60+20=80 mなので80/40=2.0 m/s。1.0 m/sは東向きの変位40 mから計算した平均の速度の大きさであり、平均の速さとは別です。3.0は前半だけの速さです。",
      hints: [
        "速さと速度を区別しよう。平均の速さでは、戻った分も移動した距離に足します。",
      ],
    },
  },
  {
    key: "basic-earth-season",
    focus: "観測条件を限定し、季節の説明に必要な要因を問う",
    question: {
      subject: "basicScience",
      basicRange: "earth",
      topic: "地学基礎",
      difficulty: 1,
      expectedSeconds: 45,
      stem: "北半球の同じ地点で、夏は冬より昼が長く、太陽の南中高度も高い。この季節変化を説明する主な仕組みはどれか。地軸の向きは公転中ほぼ一定とする。",
      options: options(
        "地球の自転が夏だけ止まること",
        "地軸が公転面に垂直な方向から傾いたまま地球が公転すること",
        "太陽が夏だけ地球の周りを公転すること",
        "月が冬だけ太陽を隠し続けること",
      ),
      correct: "b",
      explanation:
        "地軸の傾きを保ちながら公転するため、北半球が太陽の側へ傾く季節には昼が長くなり、南中高度も高くなります。自転の停止や月による継続的な遮蔽では、毎年の季節変化を説明できません。太陽が地球を公転するという説明も適切ではありません。",
      hints: [
        "地球の自転による1日の変化と、公転による1年の変化を区別しよう。地軸の傾きにも注目しよう。",
      ],
    },
  },
  {
    key: "japan-history-perspective",
    focus: "オリジナルの要約資料から制度の目的を読み取る",
    question: {
      subject: "japanHistory",
      topic: "近世の政治と経済",
      difficulty: 2,
      expectedSeconds: 60,
      stem: "江戸時代の参勤交代を説明するために作成した次の要約を読め。\n「大名は領国と江戸を往来し、妻子は原則として江戸に住んだ。往来や江戸滞在には費用がかかった。」\nこの仕組みが幕府による大名統制に役立った理由として最も適切なものはどれか。",
      options: options(
        "すべての大名が領国を失い、幕府の直轄地だけになったから",
        "大名の往来が禁止され、江戸への情報が届かなくなったから",
        "大名の負担をすべて幕府が肩代わりしたから",
        "大名とその家族を幕府の監視下に置きやすく、経済的な負担も生じたから",
      ),
      correct: "d",
      explanation:
        "江戸への定期的な出府や妻子の江戸居住は、大名を幕府が把握・統制する手段となりました。往来や滞在は大名側の負担でもありました。資料は領国の消滅、往来の禁止、幕府による費用の全額負担を示していません。ここでは参勤交代が継続して実施された時期の一般的な仕組みを扱います。",
      hints: [
        "誰がどこに住み、誰に費用がかかるのかを、幕府と大名の立場に分けて整理しよう。",
      ],
    },
  },
  {
    key: "world-history-change",
    focus: "資料から産業化による労働の変化を読み取る",
    question: {
      subject: "worldHistory",
      topic: "近代国家",
      difficulty: 1,
      expectedSeconds: 60,
      stem: "産業革命期の変化を説明するために作成した資料を読め。\n変化前：各家庭で道具を使い、それぞれの生活に合わせて生産した。\n変化後：工場に労働者が集まり、動力機械を使い、決められた時刻に生産した。\nこの資料から読み取れる変化はどれか。",
      options: options(
        "工場制機械工業が広まり、労働の場所や時間の管理が変わった",
        "工場に労働者が集まり、作業時刻を各家庭ごとに決めるようになった",
        "動力機械の利用が広まり、生産が工場から各家庭へ分散した",
        "生産場所は工場へ変わったが、労働時間の管理は変わらなかった",
      ),
      correct: "a",
      explanation:
        "家庭での分散した生産から、労働者と動力機械を工場に集める生産への変化です。工場での生産は、働く場所と共通の作業時刻の管理も伴います。他の選択肢は変化の方向が逆か、資料にない全面的な一般化です。すべての家庭生産が直ちになくなったという意味ではありません。",
      hints: [
        "変化の前後で、生産する場所、使う道具・機械、時間の決め方を一つずつ比べよう。",
      ],
    },
  },
  {
    key: "map-scale",
    focus: "単位を統一し、縮尺の分母と実距離の関係を問う",
    question: {
      subject: "geography",
      topic: "地図と地理情報",
      difficulty: 1,
      expectedSeconds: 45,
      stem: "縮尺1:25,000の地図上で、2地点間の直線距離が4.0 cmだった。実際の直線距離はどれか。地表の起伏による補正は考えない。",
      options: options("0.10 km", "0.40 km", "1.0 km", "10 km"),
      correct: "c",
      explanation:
        "地図上1 cmは実際の25,000 cm=250 mです。4.0 cmなら250×4.0=1,000 m=1.0 km。地図と実際で同じ長さの単位を使ってから換算することが大切です。10 kmや0.10 kmは桁の換算、0.40 kmは縮尺の倍率を取り違えています。",
      hints: [
        "縮尺は同じ単位どうしの比です。まず地図上1 cmが実際の何mかを求めよう。",
      ],
    },
  },
  {
    key: "ethics-universalization",
    focus: "原理の説明を与えて具体例に適用させる",
    question: {
      subject: "ethics",
      topic: "西洋思想",
      difficulty: 2,
      expectedSeconds: 60,
      stem: "カントの倫理を学ぶため、行為の方針を「誰もがその方針で行動する普遍的な規則にしてよいか」という観点から考える。この観点に最も沿った問いはどれか。",
      options: options(
        "その行為を誰にも見られずに実行できるか",
        "その方針を、同じ立場のすべての人に当てはめてもよいか",
        "その行為で自分だけが最大の利益を得られるか",
        "その行為に賛成する人の人数が最も多いか",
      ),
      correct: "b",
      explanation:
        "示された観点は、自分だけの例外を認めず、行為の方針を普遍的な規則として考えられるかを問います。見つかるかどうか、自分の利益、賛成人数は、それぞれ別の判断基準です。ここで問うのは結果の人気投票ではなく、設問で説明された原理の適用です。",
      hints: [
        "自分にとって都合がよいかと、すべての人に同じ規則を適用できるかを分けて考えよう。",
      ],
    },
  },
];

export function selectQuestionExamples(
  subject: string,
  basicRange?: string | null,
  seed = "",
) {
  const relevant = questionExamples.filter(
    ({ question: q }) =>
      q.subject === subject &&
      (subject !== "basicScience" || q.basicRange === basicRange),
  );
  let value = 2166136261;
  for (const c of seed)
    value = Math.imul(value ^ c.charCodeAt(0), 16777619) >>> 0;
  const rotate = (list: QuestionExample[], salt: number) => {
    const offset =
      seed && list.length ? ((value ^ salt) >>> 0) % list.length : 0;
    return [...list.slice(offset), ...list.slice(0, offset)];
  };
  return [
    ...rotate(relevant, 0),
    ...rotate(
      questionExamples.filter((q) => !relevant.includes(q)),
      0x9e3779b9,
    ),
  ].slice(0, 10);
}
export function generationExamples(
  subject: string,
  basicRange?: string | null,
  seed = "",
) {
  return selectQuestionExamples(subject, basicRange, seed).map(
    ({ focus, question: q }) => ({
      user: `品質見本。科目:${q.subject}。単元:${q.topic}。難度:${q.difficulty}/3。${q.basicRange ? `理科基礎の範囲:${q.basicRange}。` : ""}観点:${focus}。指定形式のオリジナル短問を1問、JSONだけで示してください。`,
      assistant: JSON.stringify(q),
    }),
  );
}
