import { MathText } from "./MathText";
import { studyContent } from "../shared/study-content";
export function StudyContent({ text }: { text: string }) {
  return (
    <div className="study-content">
      {studyContent(text).map((b, n) =>
        b.kind === "table" ? (
          <div
            key={n}
            className="study-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="資料の表"
          >
            <table>
              <thead>
                <tr>
                  {b.header.map((s, c) => (
                    <th scope="col" key={c}>
                      <MathText text={s} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((s, c) => (
                      <td key={c}>
                        <MathText text={s} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : b.kind === "code" ? (
          <pre key={n}>
            <code>{b.text}</code>
          </pre>
        ) : (
          <p key={n}>
            <MathText text={b.text} />
          </p>
        ),
      )}
    </div>
  );
}
