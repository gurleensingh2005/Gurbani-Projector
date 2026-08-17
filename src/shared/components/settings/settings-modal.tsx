"use client";
import React from 'react';
import { useSettings } from '@/shared/context/settings.context';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const ToggleItem = ({ label, description, enabled, onClick }: { label: string, description: string, enabled: boolean, onClick: () => void }) => (
    <div className="flex items-center justify-between cursor-pointer group px-1 select-none" onClick={onClick}>
        <div className="flex-1 pr-4">
            <h4 className="font-bold text-sm md:text-base text-foreground dark:text-gray-200 group-hover:text-accent transition-colors">{label}</h4>
            <p className="text-[10px] md:text-xs text-gray-500 dark:text-gray-400 leading-tight">{description}</p>
        </div>
        <div className={`w-12 h-6.5 md:w-14 md:h-8 rounded-full transition-all relative flex items-center px-1 ${enabled ? 'bg-accent' : 'bg-gray-200 dark:bg-white/10'}`}>
            <div className={`w-5 h-5 md:w-6 md:h-6 rounded-full bg-white shadow-md transition-all ${enabled ? 'translate-x-[1.4rem] md:translate-x-6' : 'translate-x-0'}`} />
        </div>
    </div>
);

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const { settings, updateSetting } = useSettings();

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-100 flex items-end sm:items-center justify-center p-0 sm:p-4 md:p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-300"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-[#1a1a1a] w-full max-w-lg sm:rounded-[2.5rem] rounded-t-[2.5rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 flex flex-col max-h-[90vh] sm:max-h-[85vh]"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header - Sticky */}
                <div className="p-6 md:p-8 border-b border-gray-100 dark:border-white/5 flex items-center justify-between bg-gray-50/50 dark:bg-white/5 shrink-0">
                    <h2 className="text-xl md:text-2xl font-bold text-foreground dark:text-white flex items-center gap-3">
                        <span className="text-xl">⚙️</span> Settings
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-200 dark:hover:bg-white/10 rounded-full transition-colors text-gray-500"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>

                {/* Content - Scrollable */}
                <div className="p-6 md:p-8 space-y-8 overflow-y-auto custom-scrollbar flex-1">
                    {/* Appearance */}
                    <section className="space-y-6">
                        <h3 className="text-[10px] md:text-xs font-black uppercase tracking-widest text-accent mb-2 px-1">Appearance</h3>

                        {/* Theme */}
                        <div className="flex bg-gray-100 dark:bg-white/5 p-1 rounded-2xl">
                            <button
                                onClick={() => updateSetting('theme', 'light')}
                                className={`flex-1 py-2.5 md:py-3 rounded-xl text-sm font-bold transition-all ${settings.theme === 'light' ? 'bg-white text-accent shadow-sm' : 'text-gray-500'}`}
                            >
                                ☀️ Light
                            </button>
                            <button
                                onClick={() => updateSetting('theme', 'dark')}
                                className={`flex-1 py-2.5 md:py-3 rounded-xl text-sm font-bold transition-all ${settings.theme === 'dark' ? 'bg-foreground text-accent shadow-sm' : 'text-gray-500'}`}
                            >
                                🌙 Dark
                            </button>
                        </div>

                        {/* Font Size */}
                        <div className="space-y-4 px-1">
                            <div className="flex justify-between items-center">
                                <h4 className="font-bold text-sm md:text-base text-foreground dark:text-gray-200">Text Scaling</h4>
                                <span className="text-[10px] md:text-xs font-black text-accent bg-accent/10 px-2.5 py-1 rounded-full">
                                    {Math.round(settings.fontSize * 100)}%
                                </span>
                            </div>
                            <input
                                type="range"
                                min="0.5"
                                max="2.0"
                                step="0.1"
                                value={settings.fontSize}
                                onChange={(e) => updateSetting('fontSize', parseFloat(e.target.value))}
                                className="w-full h-1.5 md:h-2 bg-gray-200 dark:bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#d42c5c]"
                            />
                            <div className="flex justify-between text-[9px] md:text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                                <span>Minimum</span>
                                <span>Default</span>
                                <span>Maximum</span>
                            </div>
                        </div>
                    </section>

                    {/* Reading Options */}
                    <section className="space-y-6">
                        <h3 className="text-[10px] md:text-xs font-black uppercase tracking-widest text-accent px-1">Display Options</h3>
                        <ToggleItem
                            label="Main Gurmukhi Text"
                            description="Display the original Gurmukhi script"
                            enabled={settings.showGurmukhi}
                            onClick={() => updateSetting('showGurmukhi', !settings.showGurmukhi)}
                        />
                        <ToggleItem
                            label="Larivaar Mode"
                            description="Gurmukhi without spaces"
                            enabled={settings.larivaar}
                            onClick={() => updateSetting('larivaar', !settings.larivaar)}
                        />
                        <ToggleItem
                            label="Hindi Pronunciation"
                            description="Hindi mein shabad ka ucharan dikhayein"
                            enabled={settings.showHindi}
                            onClick={() => updateSetting('showHindi', !settings.showHindi)}
                        />
                        <ToggleItem
                            label="English Meaning"
                            description="Display English meaning below lines"
                            enabled={settings.showEnglish}
                            onClick={() => updateSetting('showEnglish', !settings.showEnglish)}
                        />
                        <ToggleItem
                            label="Punjabi Teeka"
                            description="Display Punjabi translation"
                            enabled={settings.showPunjabi}
                            onClick={() => updateSetting('showPunjabi', !settings.showPunjabi)}
                        />
                    </section>
                </div>

                {/* Footer - Sticky */}
                <div className="p-6 md:p-8 bg-gray-50 dark:bg-white/2 border-t border-gray-100 dark:border-white/5 shrink-0">
                    <button
                        onClick={onClose}
                        className="w-full bg-accent hover:bg-accent/85 text-white py-3.5 md:py-4 rounded-2xl font-bold shadow-lg shadow-accent/20 transition-all active:scale-[0.98]"
                    >
                        Save & Close
                    </button>
                </div>
            </div>
        </div>
    );
};
