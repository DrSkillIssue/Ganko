import { createStore } from "solid-js/store";

export interface AppState {
  user: {
    name: string;
    email: string;
    isLoggedIn: boolean;
  };
  settings: {
    theme: "light" | "dark";
    language: string;
  };
  counters: number[];
}

const initialState: AppState = {
  user: {
    name: "",
    email: "",
    isLoggedIn: false,
  },
  settings: {
    theme: "light",
    language: "en",
  },
  counters: [],
};

export function createAppStore() {
  const [store, setStore] = createStore<AppState>(initialState);

  const login = (name: string, email: string) => {
    setStore("user", { name, email, isLoggedIn: true });
  };

  const logout = () => {
    setStore("user", { name: "", email: "", isLoggedIn: false });
  };

  const setTheme = (theme: "light" | "dark") => {
    setStore("settings", "theme", theme);
  };

  const addCounter = (value: number) => {
    setStore("counters", (counters) => [...counters, value]);
  };

  return {
    store,
    login,
    logout,
    setTheme,
    addCounter,
  };
}
