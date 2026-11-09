import { useEffect, useRef, useState } from "react";
import {
  Eraser,
  PenLine,
  Undo2,
  Trash2,
  CloudCheck,
  CloudUpload,
} from "lucide-react";
import { api } from "./api";
type Stroke = { points: [number, number][]; erase: boolean };
export function Notebook({ id, initial }: { id: string; initial: string }) {
  const ref = useRef<HTMLCanvasElement>(null),
    strokes = useRef<Stroke[]>([]),
    current = useRef<Stroke | null>(null),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [erase, setErase] = useState(false),
    [saved, setSaved] = useState(true);
  const alive = useRef(true);
  function draw() {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of [
      ...strokes.current,
      ...(current.current ? [current.current] : []),
    ]) {
      ctx.globalCompositeOperation = s.erase
        ? "destination-out"
        : "source-over";
      ctx.lineWidth = s.erase ? 24 : 2.5;
      ctx.strokeStyle = "#364c3b";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      s.points.forEach(([x, y], i) =>
        i
          ? ctx.lineTo(x * c.width, y * c.height)
          : ctx.moveTo(x * c.width, y * c.height),
      );
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }
  function persist() {
    const note = JSON.stringify(strokes.current);
    try {
      localStorage.setItem("quest-note:" + id, note);
    } catch {}
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      api("/note", { instanceId: id, note })
        .then(() => {
          // A newer stroke can be waiting while this older request completes.
          // Keep its draft and do not claim that it has been saved yet.
          try {
            if (localStorage.getItem("quest-note:" + id) === note)
              localStorage.removeItem("quest-note:" + id);
          } catch {}
          if (alive.current && JSON.stringify(strokes.current) === note)
            setSaved(true);
        })
        .catch(() => {
          if (alive.current) setSaved(false);
        });
    }, 500);
  }
  useEffect(() => {
    alive.current = true;
    try {
      const parsed = JSON.parse(
        localStorage.getItem("quest-note:" + id) ?? initial ?? "[]",
      );
      strokes.current = Array.isArray(parsed) ? parsed : [];
    } catch {
      strokes.current = [];
    }
    draw();
    return () => {
      alive.current = false;
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        const note = JSON.stringify(strokes.current);
        void fetch("/api/note", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instanceId: id, note }),
          keepalive: true,
        });
      }
    };
  }, [id]);
  function point(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    ];
  }
  return (
    <section className="notebook">
      <div className="note-toolbar">
        <span>計算メモ</span>
        <div>
          <button
            aria-label="ペン"
            className={!erase ? "selected" : ""}
            onClick={() => setErase(false)}
          >
            <PenLine size={18} />
          </button>
          <button
            aria-label="消しゴム"
            className={erase ? "selected" : ""}
            onClick={() => setErase(true)}
          >
            <Eraser size={18} />
          </button>
          <button
            aria-label="元に戻す"
            onClick={() => {
              strokes.current.pop();
              draw();
              persist();
            }}
          >
            <Undo2 size={18} />
          </button>
          <button
            aria-label="メモを全消去"
            onClick={() => {
              if (confirm("この問題のメモを消去しますか？")) {
                strokes.current = [];
                draw();
                persist();
              }
            }}
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
      <canvas
        ref={ref}
        width={900}
        height={480}
        aria-label="手書きの計算メモ"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          current.current = { points: [point(e)], erase };
          draw();
        }}
        onPointerMove={(e) => {
          if (current.current) {
            current.current.points.push(point(e));
            draw();
          }
        }}
        onPointerUp={() => {
          if (current.current) {
            strokes.current.push(current.current);
            current.current = null;
            draw();
            persist();
          }
        }}
        onPointerCancel={() => {
          if (current.current) {
            strokes.current.push(current.current);
            current.current = null;
            persist();
          }
        }}
      />
      <small>
        {saved ? <CloudCheck size={14} /> : <CloudUpload size={14} />}{" "}
        {saved ? "保存済み" : "端末に下書きを保存・同期中"}
      </small>
    </section>
  );
}
