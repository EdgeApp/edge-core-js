export function snooze(ms: number): Promise<number> {
  return new Promise(resolve => setTimeout(() => resolve(ms), ms))
}
