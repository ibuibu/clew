export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

export const modKeyLabel = isMac ? "Cmd" : "Ctrl";

export const submitKeyLabel = `${modKeyLabel}+Enter`;
