import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface SessionState {
    roomId: string;
    gurudwaraId: string;
    raagiName: string;
    isActive: boolean;
}

const initialState: SessionState = {
    roomId: "default-room",
    gurudwaraId: "default-gurudwara",
    raagiName: "Main Darbar Sahib",
    isActive: false,
};

export const sessionSlice = createSlice({
    name: "session",
    initialState,
    reducers: {
        setRoomId: (state, action: PayloadAction<string>) => {
            state.roomId = action.payload;
        },
        setGurudwaraId: (state, action: PayloadAction<string>) => {
            state.gurudwaraId = action.payload;
        },
        setRaagiName: (state, action: PayloadAction<string>) => {
            state.raagiName = action.payload;
        },
        setSessionActive: (state, action: PayloadAction<boolean>) => {
            state.isActive = action.payload;
        },
    },
});

export const { setRoomId, setGurudwaraId, setRaagiName, setSessionActive } = sessionSlice.actions;

export default sessionSlice.reducer;
