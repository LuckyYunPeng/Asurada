import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TooltipProvider } from "@/components/ui/tooltip";
// 打包字体：界面英文/数字用 Geist，代码和数据用 Geist Mono，中文都回退到苹方
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";

// 按需加载：diff 页的样式和 Shiki 不进主窗口，避免污染主窗口的透明背景
const DiffWindow = lazy(() => import("./DiffWindow"));

const params = new URLSearchParams(window.location.search);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={300}>
    {params.get("view") === "diff" ? (
      <Suspense fallback={null}>
        <DiffWindow />
      </Suspense>
    ) : (
      <App />
    )}
    </TooltipProvider>
  </React.StrictMode>,
);
