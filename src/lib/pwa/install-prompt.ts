export type InstallPromptContext = {
  /** Browser fired beforeinstallprompt (Chromium). */
  can_install: boolean;
  /** Running as installed PWA (standalone / fullscreen / iOS standalone). */
  is_standalone: boolean;
  /** Rough iOS Safari / WebKit without beforeinstallprompt. */
  is_ios: boolean;
};

export function should_show_install_prompt(ctx: InstallPromptContext): boolean {
  if (ctx.is_standalone) return false;
  return ctx.can_install || ctx.is_ios;
}

export function detect_is_standalone(
  match_media?: (query: string) => boolean,
  navigator_standalone?: boolean,
): boolean {
  if (navigator_standalone === true) return true;
  if (match_media?.("(display-mode: standalone)")) return true;
  if (match_media?.("(display-mode: fullscreen)")) return true;
  if (match_media?.("(display-mode: minimal-ui)")) return true;
  return false;
}

export function detect_is_ios(user_agent: string): boolean {
  return /iPad|iPhone|iPod/i.test(user_agent);
}
