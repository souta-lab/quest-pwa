import { useEffect, useRef } from "react";
// Foreground time is an approximate measure of study opportunity, never a score.
export function useStudyClock(
  instanceId: string | undefined,
  enabled: boolean,
) {
  const state = useRef({
    id: "",
    ms: 0,
    last: performance.now(),
    running: false,
  });
  function flush() {
    const s = state.current,
      now = performance.now();
    if (s.running)
      s.ms = Math.min(
        1800000,
        s.ms + Math.min(2000, Math.max(0, now - s.last)),
      );
    s.last = now;
  }
  useEffect(() => {
    const s = state.current;
    if (s.id !== instanceId) {
      s.id = instanceId ?? "";
      s.ms = 0;
      try {
        s.ms = Math.min(
          1800000,
          Math.max(
            0,
            Number(sessionStorage.getItem("quest-clock:" + s.id)) || 0,
          ),
        );
      } catch {}
    }
    const update = () => {
      flush();
      s.running = enabled && !document.hidden && document.hasFocus();
    };
    update();
    const timer = setInterval(() => {
      update();
      try {
        if (s.id)
          sessionStorage.setItem(
            "quest-clock:" + s.id,
            String(Math.round(s.ms)),
          );
      } catch {}
    }, 1000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      flush();
      s.running = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, [instanceId, enabled]);
  return () => {
    flush();
    return Math.round(state.current.ms);
  };
}
