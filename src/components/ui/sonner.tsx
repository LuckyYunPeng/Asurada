import { useThemeMode } from "@/theme"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheck, Info, TriangleAlert, CircleX, Loader2 } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { isDark } = useThemeMode()

  return (
    <Sonner
      theme={isDark ? "dark" : "light"}
      className="toaster group"
      position="bottom-center"
      gap={8}
      icons={{
        success: <CircleCheck className="size-[18px] text-(--ok-fg)" />,
        info: <Info className="size-[18px] text-foreground" />,
        warning: <TriangleAlert className="size-[18px] text-amber-500" />,
        error: <CircleX className="size-[18px] text-(--err-fg)" />,
        loading: <Loader2 className="size-[18px] animate-spin text-muted-foreground" />,
      }}
      style={
        {
          "--normal-bg": "color-mix(in oklab, var(--popover) 88%, transparent)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--hairline)",
          "--border-radius": "18px",
          "--width": "320px",
        } as React.CSSProperties
      }
      // 中性卡片 + 彩色图标，比整块染色更克制；sonner 自带样式选择器权重高，需要 !
      toastOptions={{
        classNames: {
          toast:
            "cn-toast !items-start !gap-2.5 !px-4 !py-3 !backdrop-blur-xl !shadow-[0_10px_32px_-8px_rgba(0,0,0,0.22),0_2px_6px_-2px_rgba(0,0,0,0.08)]",
          icon: "!mt-px !size-[18px] !m-0",
          title: "!text-[13px] !font-semibold !leading-5",
          description: "!text-xs !leading-[18px] !text-muted-foreground !line-clamp-4 !break-words",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
