import { snooze } from '../src/util/snooze'

/** Polls until the condition holds, or throws after the timeout. */
export async function waitUntil(
  condition: () => boolean,
  timeoutMs: number = 3000,
  message: string = 'condition'
): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${message}`)
    }
    await snooze(5)
  }
}
