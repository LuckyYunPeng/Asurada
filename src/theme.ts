import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";

export enum ThemeModeEnum {
  Light = "light",
  Dark = "dark",
  System = "system",
}

const THEME_KEY = "asurada.theme";
const THEME_EVENT = "theme-changed";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const isTauri = "__TAURI_INTERNALS__" in window;

function readThemeMode(): ThemeModeEnum {
  return (localStorage.getItem(THEME_KEY) as ThemeModeEnum | null) ?? ThemeModeEnum.System;
}

function applyThemeMode(mode: ThemeModeEnum) {
  const isDark =
    mode === ThemeModeEnum.Dark || (mode === ThemeModeEnum.System && darkQuery.matches);
  document.documentElement.classList.toggle("dark", isDark);
}

// 模块加载时就套上，避免首帧先亮后暗地闪一下
applyThemeMode(readThemeMode());

/** 当前生效的主题模式；跟随系统时也监听系统切换，并和其他窗口（主面板 / diff 窗口）同步 */
export function useThemeMode() {
  const [mode, setMode] = useState(readThemeMode);
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    applyThemeMode(mode);
    setIsDark(document.documentElement.classList.contains("dark"));
    if (mode !== ThemeModeEnum.System) {
      return;
    }
    const onSystemChange = () => {
      applyThemeMode(mode);
      setIsDark(darkQuery.matches);
    };
    darkQuery.addEventListener("change", onSystemChange);
    return () => darkQuery.removeEventListener("change", onSystemChange);
  }, [mode]);

  useEffect(() => {
    if (!isTauri) {
      return;
    }
    const pending = listen<ThemeModeEnum>(THEME_EVENT, ({ payload }) => setMode(payload));
    return () => {
      void pending.then((stop) => stop());
    };
  }, []);

  function onChangeThemeMode(next: ThemeModeEnum) {
    localStorage.setItem(THEME_KEY, next);
    setMode(next);
    if (isTauri) {
      emit(THEME_EVENT, next).catch((e) => console.error("同步主题失败", e));
    }
  }

  return { mode, isDark, onChangeThemeMode };
}
