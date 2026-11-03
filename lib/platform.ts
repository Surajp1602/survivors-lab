/** Shortcut badge for the Run button: ⌘ on Apple platforms, Ctrl everywhere else. */
export const shortcutLabel = (platform: string) => (/mac|iphone|ipad|ipod/i.test(platform) ? '⌘ ↵' : 'Ctrl ↵')

export function clientPlatform(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return nav.userAgentData?.platform || nav.platform || nav.userAgent
}
