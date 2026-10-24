/**
 * Where the app is running. The website build is a normal page; the mini-tool build runs
 * offline inside Xiaohongshu's container (no network, no external links or downloads, no
 * long-press menu), where window.xhs.miniTool provides saving, posting, haptics and follows.
 */
declare const __MINITOOL__: boolean | undefined;
export const MINITOOL = typeof __MINITOOL__ !== 'undefined' && __MINITOOL__;

type Callable = (options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
type MiniTool = Partial<Record<'saveImageToPhotosAlbum' | 'writeTempFile' | 'postNote' | 'vibrateShort' | 'followAuthor'
  | 'getFollowStatus' | 'getWindowInfo', Callable>>;

/** The container API, or null outside the container (and in old clients). */
export function miniTool(): MiniTool | null {
  const xhs = (window as unknown as { xhs?: { miniTool?: MiniTool } }).xhs;
  return xhs && xhs.miniTool ? xhs.miniTool : null;
}

export function has(name: keyof MiniTool): boolean {
  const api = miniTool();
  return !!api && typeof api[name] === 'function';
}

/** A short tap of haptics: the container's vibrateShort (9.50+), else the Web API. */
export function haptic(strength: 'light' | 'medium' | 'heavy' = 'light'): void {
  const api = miniTool();
  if (api && typeof api.vibrateShort === 'function') { api.vibrateShort({ type: strength }).catch(() => undefined); return; }
  if (typeof navigator.vibrate === 'function') navigator.vibrate(strength === 'heavy' ? 20 : strength === 'medium' ? 12 : 8);
}
