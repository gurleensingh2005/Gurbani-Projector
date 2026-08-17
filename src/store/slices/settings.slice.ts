import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface SettingsState {
    larivaar: boolean;
    showEnglish: boolean;
    showPunjabi: boolean;
    showHindi: boolean;
    showGurmukhi: boolean;
    theme: "light" | "dark";
    fontSize: number;
}

const DEFAULT_SETTINGS: SettingsState = {
    larivaar: false,
    showEnglish: true,
    showPunjabi: false,
    showHindi: true,
    showGurmukhi: true,
    theme: "light",
    fontSize: 1,
};

const loadInitialSettings = (): SettingsState => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    try {
        const saved = localStorage.getItem("gurbani_settings_v2");
        return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
        return DEFAULT_SETTINGS;
    }
};

export const settingsSlice = createSlice({
    name: "settings",
    initialState: loadInitialSettings(),
    reducers: {
        updateSettingField: <K extends keyof SettingsState>(
            state: SettingsState,
            action: PayloadAction<{ key: K; value: SettingsState[K] }>
        ) => {
            state[action.payload.key] = action.payload.value;
            if (typeof window !== "undefined") {
                localStorage.setItem("gurbani_settings_v2", JSON.stringify(state));
            }
        },
        setFullSettings: (state, action: PayloadAction<SettingsState>) => {
            Object.assign(state, action.payload);
            if (typeof window !== "undefined") {
                localStorage.setItem("gurbani_settings_v2", JSON.stringify(state));
            }
        },
    },
});

export const { updateSettingField, setFullSettings } = settingsSlice.actions;

export default settingsSlice.reducer;
