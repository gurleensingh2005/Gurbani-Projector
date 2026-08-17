import React from 'react';
import { useSettings } from '@/shared/context/settings.context';

interface Line {
    id: string;
    gurmukhi: string;
    translation: string;
    transliteration: string;
    transliteration_hi?: string;
    translation_pu?: string;
    translation_hi?: string;
}

interface ShabadDisplayProps {
    shabad: {
        id: string | number;
        lines: Line[];
        bani: string;
        raag?: string;
        page?: number;
    };
    matchId: string;
    currentSpeech: string;
    activeLineRef: React.RefObject<HTMLDivElement | null>;
}

/** Determines highlight state for a single Gurmukhi word */
const getWordState = (word: string, isActive: boolean, transcriptWords: string[]) => {
    const baseWord = word.replace(/[\u0A01-\u0A03\u0A3C\u0A3E-\u0A4D\u0A51\u0A70-\u0A71\u0A75]/g, "");
    const spoken = isActive && transcriptWords.some(tw => {
        const cleanTw = tw.replace(/[^a-z0-9\u0A00-\u0A7F]/g, "");
        if (word.includes(cleanTw) || baseWord.includes(cleanTw)) return true;
        if (cleanTw.length === 1 && word[0] === cleanTw) return true;
        return false;
    });
    const isVishram = /[।॥|]/.test(word);
    const isOrange = isVishram && !spoken;
    return { spoken, isOrange };
};

export const ShabadDisplay = React.memo(({ shabad, matchId, currentSpeech, activeLineRef }: ShabadDisplayProps) => {
    const { settings } = useSettings();

    return (
        <main className="flex-1 overflow-y-auto px-2 sm:px-4 md:px-12 space-y-4 sm:space-y-8 md:space-y-16 py-[25vh] sm:py-[30vh] md:py-[35vh] relative z-10 scroll-smooth custom-scrollbar">
            {/* NO LINES FALLBACK */}
            {(!shabad.lines || shabad.lines.length === 0) && (
                <div className="h-full flex items-center justify-center py-20 opacity-30 italic">
                    No lines found for this Shabad ID: {shabad.id}
                </div>
            )}
            {shabad.lines.map((line: Line) => {
                const isActive = line.id.toString() === matchId?.toString();

                const gWords = line.gurmukhi.split(/\s+/).filter(Boolean);
                const transcriptWords = currentSpeech.toLowerCase().split(/\s+/);

                return (
                    <div
                        key={line.id}
                        ref={isActive ? activeLineRef : null}
                        className={`text-center transition-all duration-1000 transform ${isActive
                            ? "opacity-100 py-6 sm:py-12 md:py-16 drop-shadow-2xl"
                            : "opacity-40 scale-[0.97] py-3 sm:py-6 md:py-8 grayscale-[0.3]"
                            }`}
                    >
                        {/* Main Gurbani Line — Mobile-first with Larivaar support */}
                        {settings.showGurmukhi && (
                            <div
                                className={`leading-tight sm:leading-snug transition-all duration-500 text-center ${isActive ? "font-black text-accent" : "font-bold text-foreground"}`}
                                style={{
                                    fontFamily: "'Noto Serif Gurmukhi', serif",
                                    fontSize: isActive
                                        ? 'calc(clamp(1.4rem, 7vw, 8rem) * var(--font-size-multiplier, 1))'
                                        : 'calc(clamp(1rem, 5vw, 6rem) * var(--font-size-multiplier, 1))',
                                    wordBreak: settings.larivaar ? 'break-all' : 'normal',
                                }}
                            >
                                {settings.larivaar ? (
                                    /* LARIVAAR: Inline spans, no gaps, natural line wrapping */
                                    gWords.map((word, wIdx) => {
                                        const { spoken, isOrange } = getWordState(word, isActive, transcriptWords);
                                        return (
                                            <span
                                                key={wIdx}
                                                className={`transition-colors duration-500 ${isActive
                                                    ? (spoken ? "text-accent drop-shadow-lg" : (isOrange ? "text-(--vishram)" : ""))
                                                    : (isOrange ? "text-(--vishram)" : "")
                                                }`}
                                            >{word}</span>
                                        );
                                    })
                                ) : (
                                    /* NORMAL: Flex wrap with gaps */
                                    <div className={`flex flex-wrap justify-center gap-x-2 sm:gap-x-3 md:gap-x-10`}>
                                        {gWords.map((word, wIdx) => {
                                            const { spoken, isOrange } = getWordState(word, isActive, transcriptWords);
                                            return (
                                                <span
                                                    key={wIdx}
                                                    className={`transition-all duration-700 rounded-sm px-0.5 ${isActive
                                                        ? (spoken ? "text-accent scale-110 drop-shadow-xl" : (isOrange ? "text-(--vishram)" : ""))
                                                        : (isOrange ? "text-(--vishram)" : "")
                                                    }`}
                                                >{word}</span>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {isActive && (
                            <div className="mt-4 sm:mt-10 md:mt-20 space-y-4 sm:space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-1000 uppercase">
                                {/* Hindi Pronunciation */}
                                {settings.showHindi && line.transliteration_hi && (
                                    <div className="max-w-7xl mx-auto py-2 sm:py-4">
                                        <p
                                            className="text-accent/90 font-bold tracking-tight leading-relaxed"
                                            style={{
                                                fontFamily: "var(--font-devanagari), sans-serif",
                                                fontSize: 'calc(clamp(1.2rem, 6vw, 5rem) * var(--font-size-multiplier, 1))'
                                            }}
                                        >
                                            {line.transliteration_hi}
                                        </p>
                                    </div>
                                )}

                                {/* English Meaning */}
                                {settings.showEnglish && line.translation && (
                                    <div className="max-w-6xl mx-auto pt-4 sm:pt-8 border-t-2 border-accent/10">
                                        <p
                                            className="text-foreground/80 font-semibold italic opacity-95 leading-relaxed tracking-tight"
                                            style={{ fontSize: 'calc(clamp(0.85rem, 3.5vw, 2.5rem) * var(--font-size-multiplier, 1))' }}
                                        >
                                            {line.translation}
                                        </p>
                                    </div>
                                )}

                                {/* Hindi Meaning */}
                                {settings.showHindi && line.translation_hi && (
                                    <div className="max-w-7xl mx-auto pt-4 sm:pt-8 border-t-2 border-accent/10">
                                        <p
                                            className="text-foreground/80 font-bold italic opacity-95 leading-relaxed tracking-tight"
                                            style={{
                                                fontFamily: "var(--font-devanagari), sans-serif",
                                                fontSize: 'calc(clamp(0.85rem, 3.5vw, 2.5rem) * var(--font-size-multiplier, 1))'
                                            }}
                                        >
                                            {line.translation_hi}
                                        </p>
                                    </div>
                                )}

                                {/* Punjabi Meaning */}
                                {settings.showPunjabi && line.translation_pu && (
                                    <div className="max-w-7xl mx-auto pt-4 sm:pt-8 border-t-2 border-accent/10">
                                        <p
                                            className="text-foreground/80 font-bold italic opacity-95 leading-relaxed tracking-tight"
                                            style={{
                                                fontFamily: "'Noto Serif Gurmukhi', serif",
                                                fontSize: 'calc(clamp(1.2rem, 6vw, 5rem) * var(--font-size-multiplier, 1))'
                                            }}
                                        >
                                            {line.translation_pu}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
            {/* Visual Spacer at Bottom */}
            <div className="h-[40vh]" />
        </main>
    );
});

ShabadDisplay.displayName = 'ShabadDisplay';
