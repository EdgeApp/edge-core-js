# API request signing (`apiSigner`)

`makeEdgeContext` / `MakeEdgeContext` can delegate HMAC for **login-server**
requests so the HMAC secret never enters the JS bundle.

This is a login-server contract only (existing HMAC in
`edge-login-server/src/middleware/with-api-key.ts`). The GUI’s `GET /v1/getKeys`
call is signed in the app, not by this library. See
[edge-react-gui `docs/HMAC_SIGNING.md`](https://github.com/EdgeApp/edge-react-gui/blob/develop/docs/HMAC_SIGNING.md).

## `EdgeContextOptions.apiSigner`

```ts
interface EdgeApiSignature {
  apiKey: string      // public id for the Authorization header
  signature: string   // base64 HMAC-SHA256 of the message
}

interface EdgeApiSigner {
  signMessage: (message: string) => Promise<EdgeApiSignature>
}

interface EdgeContextOptions {
  apiKey?: string
  apiSecret?: Uint8Array
  apiSigner?: EdgeApiSigner  // takes precedence over apiKey / apiSecret
  appId: string
  // ...
}
```

On React Native, pass the same `apiSigner` prop to `MakeEdgeContext`. The
bridge `bridgifyObject`s it and the WebView worker forwards it into
`makeContext`. Implementors must return a usable `apiKey` (non-empty, no
whitespace) and a non-empty signature.

## Canonical string

`loginFetchInner` builds the UTF-8 message the signer (or `apiSecret`) HMACs:

```
{METHOD}\n/api{path}\n{BODY}
```

- `METHOD` is the HTTP method (`POST`, `GET`, …).
- Path is `/api` plus the login route, including any query string
  (`/api/v2/login`, `/api/v2/login/create`, …).
- `BODY` is `JSON.stringify(wasLoginRequestBody(body))`, or empty for GET /
  omitted bodies.

The Authorization header is:

```
HMAC {apiKey} {signature}
```

When `apiSigner` is set, its `apiKey` and `signature` are used even if
`apiKey` / `apiSecret` were also passed. When `apiSigner` is absent and
`apiSecret` is present, the core HMACs with that secret. When neither is
present, the core sends the legacy `Token {apiKey}` header.

There is **no** timestamp line and **no** `X-Timestamp` header. That extra line
is info-server `getKeys` only; do not feed a four-line getKeys string into this
signer for login, or a three-line login string into getKeys.

## Attestation (separate from HMAC)

`EdgeContext.setAttestationToken(jwt | undefined)` copies a short-lived
info-server attestation JWT onto subsequent login-server requests as
`x-attestation-token`. It does not participate in HMAC. A missing or invalid
token does not change how this library signs; the login server may treat it as
unattested and continue. getKeys (GUI → info-server) 401s on a bad token
instead.

## Tests

`test/core/login/api-signer.test.ts` checks that `apiSigner` wins over
`apiSecret` and that the signed message starts with `POST\n/api/`.
