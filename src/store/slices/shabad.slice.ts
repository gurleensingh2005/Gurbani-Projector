import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface Line {
    id: string;
    gurmukhi: string;
    translation: string;
    transliteration: string;
    transliteration_hi?: string;
    translation_pu?: string;
    translation_hi?: string;
}

export interface Shabad {
    id: string | number;
    bani: string;
    raag?: string;
    page?: number;
    lines: Line[];
}

export interface ShabadState {
    activeShabad: Shabad | null;
    matchedLine: Line | null;
}

const initialState: ShabadState = {
    activeShabad: null,
    matchedLine: null,
};

export const shabadSlice = createSlice({
    name: "shabad",
    initialState,
    reducers: {
        setShabadResult: (state, action: PayloadAction<{ shabad: Shabad; match: Line } | null>) => {
            if (!action.payload) {
                return;
            }
            state.activeShabad = action.payload.shabad;
            state.matchedLine = action.payload.match;
        },
        updateMatchedLine: (state, action: PayloadAction<Line>) => {
            state.matchedLine = action.payload;
        },
        clearShabad: (state) => {
            state.activeShabad = null;
            state.matchedLine = null;
        },
    },
});

export const { setShabadResult, updateMatchedLine, clearShabad } = shabadSlice.actions;

export default shabadSlice.reducer;
