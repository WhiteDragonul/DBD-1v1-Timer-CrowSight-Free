// External links surfaced in the header. Opened in the user's default
// browser via the opener plugin - never inside the app webview.
import { openUrl } from "@tauri-apps/plugin-opener";

export const DISCORD_INVITE = "https://discord.gg/5DAxU8tQKM";
export const WEBSITE_URL    = "https://www.crowsightoverlay.com/";

/** Open the CrowSight Discord invite in the default browser. */
export function openDiscordInvite(): Promise<void> {
  return openUrl(DISCORD_INVITE);
}

/** Open the CrowSight website in the default browser. */
export function openWebsite(): Promise<void> {
  return openUrl(WEBSITE_URL);
}
