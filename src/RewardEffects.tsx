import { useEffect, useState, type CSSProperties } from "react";
import { Gift, Sparkles, Star, Flame, Check } from "lucide-react";
export type Reward = {
  id: string;
  xp: number;
  correct: boolean;
  combo: number;
  level: number | null;
  drop: boolean;
  goal: boolean;
};
export function RewardEffects({
  reward,
  motion,
}: {
  reward: Reward;
  motion: boolean;
}) {
  const [xp, setXp] = useState(reward.xp);
  useEffect(() => {
    if (!motion || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setXp(reward.xp);
      return;
    }
    let frame = 0;
    const start = performance.now();
    setXp(0);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 550);
      setXp(Math.round(reward.xp * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reward.id, reward.xp, motion]);
  const milestone = !!(
    reward.level ||
    reward.drop ||
    reward.goal ||
    (reward.combo > 0 && reward.combo % 5 === 0)
  );
  return (
    <div className={"reward-effects " + (milestone ? "milestone" : "")}>
      {motion && reward.correct && (
        <div className="reward-particles" aria-hidden="true">
          {Array.from({ length: milestone ? 18 : 8 }, (_, i) => (
            <i
              key={i}
              style={
                {
                  "--x": `${Math.cos(i * 2.4) * (48 + i * 2)}px`,
                  "--y": `${-45 - (i % 5) * 18}px`,
                  "--r": `${i * 47}deg`,
                  "--delay": `${(i % 4) * 25}ms`,
                  "--tone": ["#ff3d43", "#f3f5fa", "#defd72", "#b9153e"][i % 4],
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
      {motion && reward.correct && (
        <span className="reward-shockwave" aria-hidden="true" />
      )}
      <div className="reward-gain" aria-hidden="true">
        <Sparkles size={16} />
        <strong>+{xp}</strong>
        <span>XP</span>
      </div>
      {milestone && (
        <div className="reward-badges" aria-label="今回の達成">
          {reward.level && (
            <span className="reward-badge level">
              <Star size={16} />
              Lv.{reward.level}にレベルアップ
            </span>
          )}
          {reward.drop && (
            <span className="reward-badge drop">
              <Gift size={16} />
              XPブースト獲得
            </span>
          )}
          {reward.goal && (
            <span className="reward-badge">
              <Check size={16} />
              目標の問題数、突破
            </span>
          )}
          {reward.combo > 0 && reward.combo % 5 === 0 && (
            <span className="reward-badge combo">
              <Flame size={16} />
              {reward.combo}連続正解
            </span>
          )}
        </div>
      )}
    </div>
  );
}
