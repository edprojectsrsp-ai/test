"use client";

import { useMos } from "./MosContext";

export default function MiniMos() {
  const { mosAwake, mosYPos, mosAnim, isTalking, bubbleText, speakAndChat } = useMos();

  const hoverMOS = () => {
    if (!mosAwake || isTalking) return;
    speakAndChat("Hey! Need help? Just click an input field.", "😊");
  };

  return (
    <div
      className="absolute right-[60px] z-50 flex items-center gap-3 transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
      style={{ top: `${mosYPos}px` }}
    >
      <div
        className={`max-w-[200px] origin-top-right transform rounded-2xl rounded-tr-none bg-white p-3 text-black shadow-2xl transition-all ${bubbleText ? "scale-100 opacity-100" : "scale-0 opacity-0"}`}
      >
        <p className="text-xs font-semibold leading-relaxed">{bubbleText}</p>
      </div>

      <img
        src="/mos-assistant.gif"
        alt="MOS"
        onMouseEnter={hoverMOS}
        className={`mos-image ${mosAnim} ${isTalking ? "is-talking" : ""}`}
      />
    </div>
  );
}
