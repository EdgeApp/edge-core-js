/**
 * We only accept *.edge.app, localhost, or (for http/ws only) private LAN IPv4.
 * https/wss still require localhost or *.edge(test)?.app; private IPs are not
 * accepted on secure schemes.
 */
export function validateServer(server: string): void {
  const url = new URL(server)

  if (url.protocol === 'http:' || url.protocol === 'ws:') {
    if (isPrivateHost(url.hostname)) return
  }
  if (url.protocol === 'https:' || url.protocol === 'wss:') {
    if (url.hostname === 'localhost') return
    if (/^([A-Za-z0-9_-]+\.)*edge(test)?\.app$/.test(url.hostname)) return
  }

  throw new Error(
    `Only *.edge.app, localhost, or private LAN addresses (http/ws) are valid login domain names, not ${url.hostname}`
  )
}

function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost') return true
  const octets = parseIpv4(hostname)
  if (octets == null) return false
  const [a, b] = octets
  if (a === 127) return true
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    // Reject leading zeros like 010.0.0.1 which are not canonical dotted-quad
    // when they reach this helper (URL parsing may already rewrite some forms).
    if (part.length > 1 && part.startsWith('0')) return null
    octets.push(n)
  }
  return octets as [number, number, number, number]
}
