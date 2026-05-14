"use client";

import React, { useState } from "react";
import { MessageSquare, Minus, Maximize2, Minimize2, X, Send, Bot } from "lucide-react";

type WindowState = 'closed' | 'minimized' | 'default' | 'maximized';

export default function NeuralAssistant() {
  const [windowState, setWindowState] = useState<WindowState>('closed');

  // ==========================================
  // STATE 1: CLOSED (Standard Chat Bubble)
  // ==========================================
  if (windowState === 'closed') {
    return (
      <button 
        onClick={() => setWindowState('default')}
        className="fixed bottom-6 right-6 bg-cyan-600 hover:bg-cyan-500 text-white p-4 rounded-full shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all hover:scale-110 z-50 group"
        title="Open Neural Assistant"
      >
        <MessageSquare size={24} className="group-hover:animate-pulse" />
      </button>
    );
  }

  // ==========================================
  // STATE 2: MINIMIZED (Small Floating Robot)
  // ==========================================
  if (windowState === 'minimized') {
    return (
      <button 
        onClick={() => setWindowState('default')}
        className="fixed bottom-6 right-6 bg-[#111115] hover:bg-gray-800 border-2 border-cyan-800/80 text-cyan-400 p-4 rounded-full shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all hover:scale-110 z-50 group"
        title="Restore Neural Assistant"
      >
        <Bot size={24} className="group-hover:animate-bounce" />
      </button>
    );
  }

  // ==========================================
  // STATES 3 & 4: DEFAULT & MAXIMIZED
  // ==========================================
  const windowClasses = windowState === 'maximized' 
    ? "fixed inset-4 md:inset-10 z-50 rounded-xl" // Maximized (Almost full screen)
    : "fixed bottom-6 right-6 w-80 md:w-96 h-[500px] z-50 rounded-xl"; // Default (Floating Panel)

  return (
    <div className={`${windowClasses} bg-[#111115] border border-cyan-900/50 shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ease-in-out`}>
      
      {/* WINDOW HEADER */}
      <div className="bg-gradient-to-r from-gray-900 to-cyan-950/30 p-3 flex items-center justify-between border-b border-cyan-900/50">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-cyan-400" />
          <h3 className="text-sm font-bold text-gray-200">Neural MOS Assistant</h3>
        </div>
        
        {/* ACTION CONTROLS */}
        <div className="flex items-center gap-2 text-gray-400">
          {/* Minimize Button (Shrinks to Robot Icon) */}
          <button 
            onClick={() => setWindowState('minimized')} 
            className="hover:text-white hover:bg-gray-700/50 p-1.5 rounded transition-colors"
            title="Minimize to Robot"
          >
            <Minus size={16} />
          </button>
          
          {/* Maximize / Restore Down Button */}
          <button 
            onClick={() => setWindowState(windowState === 'maximized' ? 'default' : 'maximized')} 
            className="hover:text-white hover:bg-gray-700/50 p-1.5 rounded transition-colors"
            title={windowState === 'maximized' ? "Restore Down" : "Maximize"}
          >
            {windowState === 'maximized' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>

          {/* Close Button (Shrinks to Chat Bubble) */}
          <button 
            onClick={() => setWindowState('closed')} 
            className="hover:text-rose-400 hover:bg-rose-900/30 p-1.5 rounded transition-colors"
            title="Close Assistant"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* CHAT HISTORY AREA */}
      <div className="flex-1 bg-[#09090b]/80 p-4 overflow-y-auto space-y-4">
        <div className="flex gap-3 max-w-[85%]">
          <div className="bg-cyan-900/40 border border-cyan-800/50 p-3 rounded-lg rounded-tl-none text-sm text-gray-200 leading-relaxed">
            System online. I am tracking 25 active schemes. How can I assist with the Corporate AMR baseline today?
          </div>
        </div>
      </div>

      {/* INPUT AREA */}
      <div className="p-3 bg-gray-900 border-t border-gray-800">
        <div className="relative">
          <input 
            type="text" 
            placeholder="Ask the Brain engine..." 
            className="w-full bg-[#09090b] border border-gray-700 rounded-lg py-2.5 pl-3 pr-10 text-sm text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
          />
          <button className="absolute right-2 top-2 text-gray-400 hover:text-cyan-400 transition-colors p-0.5">
            <Send size={16} />
          </button>
        </div>
      </div>

    </div>
  );
}
