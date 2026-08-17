import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface ProjectorState {
    activeLineId: string | null;
    isAutoScrollEnabled: boolean;
    fontSizeMultiplier: number;
}

const initialState: ProjectorState = {
    activeLineId: null,
    isAutoScrollEnabled: true,
    fontSizeMultiplier: 1.0,
};

export const projectorSlice = createSlice({
    name: "projector",
    initialState,
    reducers: {
        setActiveLineId: (state, action: PayloadAction<string | null>) => {
            state.activeLineId = action.payload;
        },
        setAutoScroll: (state, action: PayloadAction<boolean>) => {
            state.isAutoScrollEnabled = action.payload;
        },
        setFontSizeMultiplier: (state, action: PayloadAction<number>) => {
            state.fontSizeMultiplier = action.payload;
        },
    },
});

export const { setActiveLineId, setAutoScroll, setFontSizeMultiplier } = projectorSlice.actions;

export default projectorSlice.reducer;
