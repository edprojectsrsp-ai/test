"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";

type ChatMessage = { text: string; mood: string; id: number };

interface MosContextType {
  mosAwake: boolean;
  chatHistory: ChatMessage[];
  mosYPos: number;
  mosAnim: string;
  isTalking: boolean;
  bubbleText: string;
  initMOS: () => void;
  speakAndChat: (text: string, mood: string) => void;
  focusField: (e: React.FocusEvent<HTMLElement>, text: string, mood: string) => void;
}

const MosContext = createContext<MosContextType | null>(null);

export const MosProvider = ({ children }: { children: React.ReactNode }) => {
  const [mosAwake, setMosAwake] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [mosYPos, setMosYPos] = useState(150);
  const [mosAnim, setMosAnim] = useState("");
  const [isTalking, setIsTalking] = useState(false);
  const [bubbleText, setBubbleText] = useState("");

  const synthRef = useRef<SpeechSynthesis | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const mosAwakeRef = useRef(false);

  useEffect(() => {
    mosAwakeRef.current = mosAwake;
  }, [mosAwake]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      synthRef.current = window.speechSynthesis;
      const setVoice = () => {
        const voices = synthRef.current?.getVoices() || [];
        voiceRef.current =
          voices.find((v) => v.name.includes("Female") || v.name.includes("Google US English")) ||
          voices[0] ||
          null;
      };
      setVoice();
      synthRef.current.onvoiceschanged = setVoice;
    }
  }, []);

  const triggerMove = (moveClass: string) => {
    setMosAnim("");
    setTimeout(() => setMosAnim(moveClass), 10);
  };

  const speakAndChat = (text: string, mood: string) => {
    if (!mosAwakeRef.current) return;

    setChatHistory((prev) => [...prev, { text, mood, id: Date.now() }]);
    setBubbleText(text);
    if (mood === "⚠️") triggerMove("anim-warning");

    setIsTalking(true);
    if (synthRef.current) {
      synthRef.current.cancel();
      const utterThis = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) utterThis.voice = voiceRef.current;
      utterThis.pitch = 1.2;
      utterThis.rate = 1.05;
      utterThis.onend = () => {
        setIsTalking(false);
        setTimeout(() => setBubbleText(""), 1500);
      };
      synthRef.current.speak(utterThis);
    } else {
      setIsTalking(false);
      setTimeout(() => setBubbleText(""), 1500);
    }
  };

  const initMOS = () => {
    if (mosAwakeRef.current) return;
    mosAwakeRef.current = true;
    setMosAwake(true);
    triggerMove("anim-success");
    speakAndChat("Hi! I'm MOS. I am online and ready to guide you step by step.", "🎉");
  };

  const focusField = (e: React.FocusEvent<HTMLElement>, text: string, mood: string) => {
    if (!mosAwakeRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setMosYPos(rect.top - 50);
    triggerMove("anim-guide");
    speakAndChat(text, mood);
  };

  return (
    <MosContext.Provider
      value={{
        mosAwake,
        chatHistory,
        mosYPos,
        mosAnim,
        isTalking,
        bubbleText,
        initMOS,
        speakAndChat,
        focusField,
      }}
    >
      {children}
    </MosContext.Provider>
  );
};

export const useMos = () => {
  const ctx = useContext(MosContext);
  if (!ctx) throw new Error("useMos must be used within MosProvider");
  return ctx;
};
