import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface SearchState {
    query: string;
    lastSearch: string;
    currentSpeech: string;
    status: "idle" | "searching" | "success" | "error";
    errorMessage: string;
}

const initialState: SearchState = {
    query: "",
    lastSearch: "",
    currentSpeech: "",
    status: "idle",
    errorMessage: "",
};

export const searchSlice = createSlice({
    name: "search",
    initialState,
    reducers: {
        setQuery: (state, action: PayloadAction<string>) => {
            state.query = action.payload;
        },
        setLastSearch: (state, action: PayloadAction<string>) => {
            state.lastSearch = action.payload;
        },
        setCurrentSpeech: (state, action: PayloadAction<string>) => {
            state.currentSpeech = action.payload;
        },
        setSearchStatus: (state, action: PayloadAction<SearchState["status"]>) => {
            state.status = action.payload;
        },
        setSearchError: (state, action: PayloadAction<string>) => {
            state.errorMessage = action.payload;
            state.status = "error";
        },
        resetSearch: (state) => {
            state.query = "";
            state.currentSpeech = "";
            state.lastSearch = "";
            state.status = "idle";
            state.errorMessage = "";
        },
    },
});

export const {
    setQuery,
    setLastSearch,
    setCurrentSpeech,
    setSearchStatus,
    setSearchError,
    resetSearch,
} = searchSlice.actions;

export default searchSlice.reducer;
