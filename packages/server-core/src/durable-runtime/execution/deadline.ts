import { setTimeout, clearTimeout } from 'node:timers'

/** A deadline bounds resource draining; the original promise remains observed. */
export async function withinDeadline<T>(pending: Promise<T>, milliseconds: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([pending, new Promise<undefined>(resolve => {
      timer = setTimeout(() => resolve(undefined), milliseconds)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
