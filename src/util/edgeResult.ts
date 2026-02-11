import { EdgeResult } from '../types/types'

export async function makeEdgeResult<T>(
  promise: Promise<T>
): Promise<EdgeResult<T>> {
  try {
    return { ok: true, result: await promise }
  } catch (error) {
    return { ok: false, error }
  }
}
