let suppressStandaloneLauncherBlurUntil = 0

export function suppressStandaloneLauncherBlur(durationMs = 600): void {
  suppressStandaloneLauncherBlurUntil = Math.max(
    suppressStandaloneLauncherBlurUntil,
    Date.now() + durationMs,
  )
}

export function shouldSuppressStandaloneLauncherBlur(): boolean {
  return Date.now() < suppressStandaloneLauncherBlurUntil
}
