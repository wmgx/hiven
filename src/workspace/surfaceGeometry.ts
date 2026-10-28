/** Surface bodies use four fixed heights; command results measure their content. */
export function surfaceHeight(requested = 480): number {
  return [400, 480, 560, 640].find(height => height >= requested) ?? 640
}
