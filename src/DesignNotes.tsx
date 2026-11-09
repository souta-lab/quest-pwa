import { BookOpen, ChevronRight } from "lucide-react";
export function DesignNotes() {
  return (
    <details className="card design-notes">
      <summary>
        <span>
          <BookOpen size={19} />
          この画面の設計と研究
        </span>
        <ChevronRight size={20} />
      </summary>
      <p>
        基礎を例で理解し、教材を閉じて書き、初見の別問で使い、間隔を空けて思い出す。知識のルートと4段階の記録で、何ができたかを見えるようにしています。
      </p>
      <ul>
        <li>
          <a
            href="https://pubmed.ncbi.nlm.nih.gov/24059563/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Smith・Karpicke：短答・4択・両者を組み合わせた想起練習
          </a>
        </li>
        <li>
          <a
            href="https://ies.ed.gov/ncee/wwc/practiceguide/1"
            target="_blank"
            rel="noopener noreferrer"
          >
            IES：学習間隔・例題と問題の交互練習・想起練習
          </a>
        </li>
        <li>
          <a
            href="https://www.dnc.ac.jp/kyotsu/shiken_jouhou/r9/index.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            大学入試センター：令和9年度の出題方針
          </a>
        </li>
        <li>
          <a
            href="https://pubmed.ncbi.nlm.nih.gov/18298272/"
            target="_blank"
            rel="noopener noreferrer"
          >
            選択と内発的動機づけ：41研究のメタ分析
          </a>
        </li>
        <li>
          <a
            href="https://pubmed.ncbi.nlm.nih.gov/26479070/"
            target="_blank"
            rel="noopener noreferrer"
          >
            進捗の確認と目標達成：138研究のメタ分析
          </a>
        </li>
        <li>
          <a
            href="https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2019.03087/full"
            target="_blank"
            rel="noopener noreferrer"
          >
            学習に役立つフィードバック：教育研究のメタ分析
          </a>
        </li>
      </ul>
      <p className="muted">
        短答が常に4択より優れるとはいえません。先に考えを残す手順は、偶然の正解と学習の確認を分けるための設計です。研究の知見を応用したもので、このアプリ自体の得点向上・動機づけ効果は未検証です。
      </p>
    </details>
  );
}
