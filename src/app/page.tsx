"use client";
import React, { useState, useEffect } from "react";
import { useGurbaniProjector } from "@/shared/hooks/use-gurbani-projector";
import { LotusBackground } from "@/shared/components/ui/lotus-background";
import { HomePlaceholder } from "@/shared/components/ui/home-placeholder";
import { ShabadDisplay } from "@/shared/components/projector/shabad-display";
import { SettingsModal } from "@/shared/components/settings/settings-modal";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const {
    result,
    listening,
    transcript,
    currentSpeech,
    lastSearch,
    activeLineRef,
    startListening,
    stopListening
  } = useGurbaniProjector();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === "Space") {
        e.preventDefault();
        if (listening) {
          stopListening();
        } else {
          startListening();
        }
      }
      if (e.code === "KeyF") {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mounted, listening, startListening, stopListening]);

  if (!mounted) return (
    <div className="h-screen bg-background flex flex-col items-center justify-center">
      <div className="animate-pulse text-accent/20 text-4xl">ੴ</div>
    </div>
  );

  return (
    <div className="h-dvh bg-background text-foreground flex flex-col relative select-none font-sans transition-colors duration-500">
      <LotusBackground />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {result?.shabad ? (
        <ShabadDisplay
          shabad={result.shabad}
          matchId={result.match?.id}
          currentSpeech={currentSpeech}
          activeLineRef={activeLineRef}
        />
      ) : (
        <HomePlaceholder />
      )}

      {/* Footer Controls */}
      <footer className="fixed bottom-0 left-0 right-0 p-6 md:p-12 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col md:flex-row justify-between items-center md:items-end gap-6 bg-linear-to-t from-background via-background/90 to-transparent transition-colors duration-500">
        <div className="text-center md:text-left">
        </div>

        <div className="flex flex-col items-center md:items-end gap-3 w-full md:w-auto">
          {listening && (lastSearch || transcript) && (
            <button
              onClick={stopListening}
              className="bg-black/5 dark:bg-white/5 backdrop-blur-md px-4 py-2 md:px-6 rounded-full border border-black/5 dark:border-white/5 animate-pulse max-w-[90vw] transition-all hover:bg-black/10 cursor-pointer text-left"
            >
              <p className="text-foreground text-lg md:text-xl font-bold tracking-wide truncate" style={{ fontFamily: "'Noto Serif Gurmukhi', serif" }}>
                {lastSearch || transcript}
              </p>
            </button>
          )}
          {!listening && (
            <div className="flex items-center gap-4 self-center md:self-end">
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="w-10 h-10 md:w-12 md:h-12 rounded-full glass-morphism flex items-center justify-center text-foreground hover:scale-110 active:scale-95 transition-all cursor-pointer group pointer-events-auto"
                aria-label="Open Settings"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-45 transition-transform duration-500"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.72V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.17a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
              </button>

              <button
                onClick={startListening}
                className="bg-accent text-white shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-full"
                aria-label="Start Listening"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 md:w-6 md:h-6">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                  <line x1="12" x2="12" y1="19" y2="22"></line>
                </svg>
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
