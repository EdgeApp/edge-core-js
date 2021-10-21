// @flow

/**
 * Object.assign
 */
function assign(out: any): any {
  if (out == null) {
    throw new TypeError('Cannot convert undefined or null to object')
  }
  out = Object(out)

  for (let i = 1; i < arguments.length; ++i) {
    const from = arguments[i]
    if (from == null) continue

    for (const key in from) {
      if (Object.prototype.hasOwnProperty.call(from, key)) {
        out[key] = from[key]
      }
    }
  }
  return out
}

/**
 * Array.fill
 */
function fill(value: any, start?: number, end?: number): any[] {
  const length: number = this.length
  function clamp(endpoint: number): number {
    return endpoint < 0
      ? Math.max(length + endpoint, 0)
      : Math.min(endpoint, length)
  }
  const first = start != null ? clamp(start) : 0
  const last = end != null ? clamp(end) : length

  for (let i = first; i < last; ++i) {
    this[i] = value
  }
  return this
}

/**
 * Array.find
 */
function find(
  test: (value: any, i: number, array: any[]) => boolean,
  testThis?: any
): any {
  for (let i = 0; i < this.length; ++i) {
    const value = this[i]
    if (test.call(testThis, value, i, this)) {
      return value
    }
  }
}

/**
 * Array.includes
 */
function includes(target: any): boolean {
  return Array.prototype.indexOf.call(this, target) >= 0
}

/**
 * Adds a non-enumerable method to an object.
 */
function safeAdd(object: any, name: string, value: any): void {
  if (typeof object[name] !== 'function') {
    Object.defineProperty(object, name, {
      configurable: true,
      writable: true,
      value
    })
  }
}

// Perform the polyfill:
safeAdd(Object, 'assign', assign)
safeAdd(Array.prototype, 'fill', fill)
safeAdd(Array.prototype, 'find', find)
safeAdd(Array.prototype, 'includes', includes)
safeAdd(Uint8Array.prototype, 'fill', Array.prototype.fill)
