/**
 * Where the app is running. The website build is a normal page; the mini-tool build runs
 * offline inside Xiaohongshu's container (no network, no external links or downloads, no
 * long-press menu), where window.xhs.miniTool provides saving, posting, haptics and follows.
 */
declare const __MINITOOL__: boolean | undefined;
export const MINITOOL = typeof __MINITOOL__ !== 'undefined' && __MINITOOL__;

type Callable = (options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
type MiniTool = Partial<Record<'saveImageToPhotosAlbum' | 'writeTempFile' | 'postNote' | 'vibrateShort' | 'followAuthor'
  | 'getFollowStatus' | 'getWindowInfo' | 'getStorage' | 'setStorage' | 'interactionOpenApi' | 'getLaunchOptions', Callable>>;

/** The container API, or null outside the container (and in old clients). */
export function miniTool(): MiniTool | null {
  const xhs = (window as unknown as { xhs?: { miniTool?: MiniTool } }).xhs;
  return xhs && xhs.miniTool ? xhs.miniTool : null;
}

export function has(name: keyof MiniTool): boolean {
  const api = miniTool();
  return !!api && typeof api[name] === 'function';
}

/** Persistent key/value: the container's Storage (9.46+), else localStorage. Never throws. */
export async function loadValue(key: string): Promise<string | null> {
  const api = miniTool();
  try {
    if (api && typeof api.getStorage === 'function') { const r = await api.getStorage({ key }); return typeof r.data === 'string' ? JSON.parse(r.data) : null; }
    const v = localStorage.getItem(key);
    return v === null ? null : JSON.parse(v);
  } catch { return null; }
}
export async function saveValue(key: string, value: string): Promise<void> {
  const api = miniTool();
  try {
    if (api && typeof api.setStorage === 'function') await api.setStorage({ key, data: JSON.stringify(value) });
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* not persisted: the prompt may come back next session, never within this one */ }
}

/** A short tap of haptics: the container's vibrateShort (9.50+), else the Web API. */
export function haptic(strength: 'light' | 'medium' | 'heavy' = 'light'): void {
  const api = miniTool();
  if (api && typeof api.vibrateShort === 'function') { api.vibrateShort({ type: strength }).catch(() => undefined); return; }
  if (typeof navigator.vibrate === 'function') navigator.vibrate(strength === 'heavy' ? 20 : strength === 'medium' ? 12 : 8);
}
