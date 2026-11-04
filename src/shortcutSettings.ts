/** 与后端 settings.json / Tauri 全局快捷键字符串一致 */
export const DEFAULT_TOGGLE_SHORTCUT_DISPLAY = "⌃E";

const MODIFIER_ONLY = new Set([
  "Alt",
  "Meta",
  "Control",
  "Shift",
  "Super",
]);

/** 将 KeyboardEvent 转为 Tauri global-shortcut 格式，非法或纯修饰键返回 null */
export function keyboardEventToShortcut(event: KeyboardEvent): string | null {
  event.preventDefault();
  event.stopPropagation();

  const parts: string[] = [];
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Super");
  if (event.shiftKey) parts.push("Shift");
  if (event.ctrlKey) parts.push("Control");

  const main = mainKeyFromEvent(event);
  if (!main || MODIFIER_ONLY.has(main)) {
    return null;
  }
  if (parts.length === 0) {
    return null;
  }

  parts.push(main);
  return parts.join("+");
}

function mainKeyFromEvent(event: KeyboardEvent): string | null {
  const { code } = event;
  if (code.startsWith("Key") || code.startsWith("Digit")) {
    return code;
  }
  if (/^F\d{1,2}$/.test(code)) {
    return code;
  }
  const named: Record<string, string> = {
    Space: "Space",
    Tab: "Tab",
    Enter: "Enter",
    Backspace: "Backspace",
    Delete: "Delete",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Escape: "Escape",
    Comma: "Comma",
    Period: "Period",
    Slash: "Slash",
    Backslash: "Backslash",
    BracketLeft: "BracketLeft",
    BracketRight: "BracketRight",
    Semicolon: "Semicolon",
    Quote: "Quote",
    Backquote: "Backquote",
    Minus: "Minus",
    Equal: "Equal",
  };
  return named[code] ?? null;
}
