// @flow

const shown: { [name: string]: true } = {}

export function deprecate(name: string, replacement: string) {
  if (shown[name]) return
  shown[name] = true

  console.warn(`"${name}" is deprecated. Please use "${replacement}" instead.`)
}
