/**
 * We only accept *.edge.app or localhost as valid domain names.
 */
export function validateServer(server: string): void {
  const url = new URL(server)

  if (url.protocol === 'http:' || url.protocol === 'ws:') {
    if (url.hostname === 'localhost') return
  }
  if (url.protocol === 'https:' || url.protocol === 'wss:') {
    if (url.hostname === 'localhost') return
    if (/^([A-Za-z0-9_-]+\.)*edge(test)?\.app$/.test(url.hostname)) return
  }

  throw new Error(
    `Only *.edge.app or localhost are valid login domain names, not ${url.hostname}`
  )
}
