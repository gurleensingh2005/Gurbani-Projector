"use client";
import React, { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/store.hooks";
import { updateSettingField, SettingsState } from "@/store/slices/settings.slice";

export type Settings = SettingsState;

export interface SettingsContextType {
    settings: Settings;
    updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const settings = useAppSelector((state) => state.settings);
    const dispatch = useAppDispatch();

    useEffect(() => {
        if (typeof window !== "undefined") {
            document.documentElement.setAttribute("data-theme", settings.theme);
            if (settings.theme === "dark") {
                document.body.classList.add("dark-mode");
            } else {
                document.body.classList.remove("dark-mode");
            }
            document.documentElement.style.setProperty("--font-size-multiplier", settings.fontSize.toString());
        }
    }, [settings.theme, settings.fontSize]);

    return <>{children}</>;
};

export const useSettings = (): SettingsContextType => {
    const settings = useAppSelector((state) => state.settings);
    const dispatch = useAppDispatch();

    const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
        dispatch(updateSettingField({ key, value }));
    };

    return { settings, updateSetting };
};
