import { useEffect, type CSSProperties } from "react";

import { NOTICE_SECONDS, useLabNoticeStore, type LabNoticeTone } from "../lib/useLabNoticeStore";

/**
 * The strip at the top of the screen for things the lab refuses or charges
 * for — «нельзя слить», a wrong mixing order, a cracked tube. Sits above the
 * scene rather than in the tablet: the player is looking at the bench when
 * it happens and should not have to open anything to learn why.
 */
export function LabNoticeOverlay() {
  const notice = useLabNoticeStore((state) => state.notice);
  const dismiss = useLabNoticeStore((state) => state.dismiss);

  // A repeated notice is a new object (fresh `shownAt`), so it restarts the timer.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => dismiss(notice.id), NOTICE_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;
  return (
    <div style={noticeStyle(notice.tone)} role="alert">
      {notice.text}
    </div>
  );
}

const TONES: Record<LabNoticeTone, { border: string; glow: string; text: string }> = {
  info: { border: "rgba(56, 189, 248, 0.5)", glow: "rgba(56, 189, 248, 0.25)", text: "#d6f3ff" },
  refusal: { border: "rgba(252, 211, 77, 0.6)", glow: "rgba(252, 211, 77, 0.22)", text: "#fef3c7" },
  error: { border: "rgba(248, 113, 113, 0.7)", glow: "rgba(248, 113, 113, 0.3)", text: "#fee2e2" },
};

const noticeStyle = (tone: LabNoticeTone): CSSProperties => ({
  position: "absolute",
  top: 20,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 20,
  maxWidth: "min(640px, calc(100vw - 32px))",
  padding: "10px 18px",
  borderRadius: 12,
  border: `1px solid ${TONES[tone].border}`,
  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(8, 14, 26, 0.95))",
  boxShadow: `0 0 24px ${TONES[tone].glow}`,
  color: TONES[tone].text,
  fontSize: 14,
  fontWeight: 600,
  textAlign: "center",
  pointerEvents: "none",
});
