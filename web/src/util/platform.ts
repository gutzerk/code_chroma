/** True on Apple platforms, where Cmd (not Ctrl) is the command modifier. */
export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
