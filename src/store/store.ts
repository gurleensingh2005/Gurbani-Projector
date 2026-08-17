import { configureStore } from "@reduxjs/toolkit";
import searchReducer from "@/store/slices/search.slice";
import shabadReducer from "@/store/slices/shabad.slice";
import projectorReducer from "@/store/slices/projector.slice";
import sessionReducer from "@/store/slices/session.slice";
import settingsReducer from "@/store/slices/settings.slice";

export const makeStore = () => {
    return configureStore({
        reducer: {
            search: searchReducer,
            shabad: shabadReducer,
            projector: projectorReducer,
            session: sessionReducer,
            settings: settingsReducer,
        },
        devTools: process.env.NODE_ENV !== "production",
    });
};

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
