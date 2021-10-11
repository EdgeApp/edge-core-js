# Edge key formats

The Edge account system makes it possible to backup and restore crypto-currency keys. These keys are *immutable* for safety, and there is no way to upgrade legacy keys. This means Edge support every key format customers have ever created and stored in our system, both now and for the rest of time. If changing a key format ever becomes necessary, the new format must coexist with the old format, and the wallet must be able to read both.

This creates enormous pressure to keep the key formats stable, simple, and documented. This file serves as documentation.

## Splitting

Every key has an associated wallet id. If an Edge account contains two keys with the same wallet id, the keys merge together. Missing properties are fine, but conflicting properties produce a a "key integrity violation" error. This error makes it impossible to log into the account, so it is critically important that keys never conflict.

To split a wallet that contains coins on multiple keys, Edge just makes a new wallet with a copy of the original keys. Since users can split wallets multiple times and in multiple directions, it is important that splitting something like a BTC wallet to BCH, and then splitting the BCH wallet back to BTC, produces the exact same keys that the BTC wallet started with. Otherwise, there will be a key integrity violation.

This means that splitting cannot "upgrade" or otherwise modify keys - if keys are in a legacy format on the original chain, they must remain in that legacy format on the new chain as well.

When Edge splits keys, it assigns new wallet id's using a deterministic formula that keeps this round-trip property intact:

    newWalletId = oldWalletId xor hmacSha256(dataKey, oldWalletType) xor hmacSha256(dataKey, newWalletType)

As the user splits from wallet type to wallet type, the xor operation will cancel out any intermediate steps. So, whether the user goes from BTC to BCH to BSV, or straight from BTC to BSV, the resulting wallet id will be the same. More importantly, if the user ever returns to BTC from any of those split wallets, they will return to the original wallet id.

Edge uses this same xor trick for the syncKey as well, so each split wallet receives its own data storage.

## Public keys

Edge would eventually like to have read-only wallets. For these wallets, we plan to derive public keys from private keys. It should be possible to merge the public and private keys to make a unified public / private key bundle. Thus, no property names in the public key format can conflict with property names in the private key format.

Not all wallets can operate with just public keys. Monero, in particular, has trouble with this. These wallets can skip implementing `derivePublicKeys`, in which case they will not be able to operate in read-only mode.

Since Edge doesn't have this feature yet, the public key format is "work in progress". We *do* cache some element of these keys on disk for faster startup times, so the format needs to at least be semi-functional.

# Detailed key formats

## Storage keys

All private key formats include the following two properties:

```typescript
interface PrivateStorageKey {
  dataKey: string, // A 256-bit base64 encoded integer
  syncKey: string // A 160-bit base64 encoded integer
}
```

The `syncKey` uniquely identifies the wallet's Git repository on the Edge server, and the `dataKey` is the AES-256 encryption key for the data in that repository.

## wallet:bitcoin

The private key format is as follows:

```typescript
interface PrivateBitcoinKey extends PrivateStorageKey {
  bitcoinKey: string, // Other names are possible
  format?: 'bip32' | 'bip44' | 'bip49' | 'bip84',
  coinType?: number
}
```

The field `bitcoinKey` either contains:

- A mnemonic string according to BIP 39
- A 256-bit base64 encoded integer (legacy)

The `bitcoinKey` should be decoded using either BIP 39 or base64 to yield the wallet seed entropy. From there, BIP 32 specifies how to derive wallet keys using some path determined by `format` and `coinType`. The name `bitcoinKey` only applies to Bitcoin wallets; other coins use other names for this field.

- bip32
  - Receiving & change branch: m/0/0/n
  - Script: p2pkh
- bip44
  - Receiving branch: m/44'/coinType'/0'/0/n
  - Change branch: m/44'/coinType'/0'/1/n
  - Script: p2pkh
- bip49
  - Receiving branch: m/49'/coinType'/0'/0/n
  - Change branch: m/49'/coinType'/0'/1/n
  - Script: segwit p2wpkh embedded in p2sh
- bip84
  - Receiving branch: m/84'/coinType'/0'/0/n
  - Change branch: m/84'/coinType'/0'/1/n
  - Script: segwit p2wpkh

If `format` is missing, the wallet uses a default of bip32.

If the `coinType` is missing, the default is 0 for Bitcoin. Other coins use different defaults for `coinType`.

### Other Bitcoin-derived coins

Many Bitcoin-like coins use a format similar to `wallet:bitcoin`, with a different name for the `bitcoinKey` property and a different default `coinType`. Here is the chart:

| Wallet type | Key name | Default coin type |
|-------------|----------|-------------------|
| `wallet:bitcoin` | `bitcoinKey` | 0 |
| `wallet:bitcoin-testnet` | `bitcointestnetKey` | 1 |
| `wallet:bitcoincash-testnet` | `bitcoincashtestnetKey` | 1? |
| `wallet:bitcoincash` | `bitcoincashKey` | 145 |
| `wallet:bitcoingold-testnet` | `bitcoingoldKey`? | 156? |
| `wallet:bitcoingold` | `bitcoingoldKey` | 156 |
| `wallet:bitcoinsv` | `bitcoinsvKey` | 145 |
| `wallet:dash` | `dashKey` | 5 |
| `wallet:digibyte` | `digibyteKey` | 20 |
| `wallet:dogecoin` | `dogecoinKey` | 3 |
| `wallet:eboost` | `eboostKey` | 2? |
| `wallet:feathercoin` | `feathercoinKey` | 8 |
| `wallet:groestlcoin` | `groestlcoinKey` | 17 |
| `wallet:litecoin` | `litecoinKey` | 2 |
| `wallet:qtum` | `qtumKey` | 2301 |
| `wallet:smartcash` | `smartcashKey` | 224 |
| `wallet:ufo` | `uniformfiscalobjectKey` | 202 |
| `wallet:vertcoin` | `vertcoinKey` | 28 |
| `wallet:zcoin` | `zcoinKey` | 136 |

All coins default to bip32 if `format` is missing.

### Splitting

Since different Bitcoin-derived coins have different default coin types, splitting a key without `coinType` filled in will look for money on the wrong branch. Therefore, Edge must explicitly fill in `coinType` as part of the splitting process.

This currently happens in the core, but should move to the Bitcoin plugin.

### Public keys

```typescript
interface PublicBitcoinKey {
  bitcoinXpub: string,
  format?: 'bip32' | 'bip44' | 'bip49' | 'bip84',
  coinType?: number
}
```

This format is currently disabled, since it has problems. Given the presence of hardened derivation in several of the formats, it's not clear exactly which Xpub is being saved here. This needs to be locked down before the format can be enabled.

### Wrong wallet types

Edge had a mistake early on which produced a lot of keys with invalid wallet types, like `wallet:bitcoin-bip44`. There is no plugin called `bitcoin-bip44`, so the normal plugin-matching logic doesn't apply here.

To fix this, the Edge core detects the following wallet types, deletes the `-bip..` part, and adds a `format` property with the bip number. This translates the anomalous keys into the standard `wallet:bitcoin` format:

- `wallet:bitcoin-bip44`
- `wallet:bitcoin-bip49`
- `wallet:bitcoincash-bip32`
- `wallet:bitcoincash-bip44`
- `wallet:bitcoincash-bip44-testnet`
- `wallet:bitcoin-bip44-testnet`
- `wallet:bitcoin-bip49-testnet`
- `wallet:dash-bip44`
- `wallet:dogecoin-bip44`
- `wallet:litecoin-bip44`
- `wallet:litecoin-bip49`
- `wallet:feathercoin-bip49`
- `wallet:feathercoin-bip44`
- `wallet:qtum-bip44`
- `wallet:ufo-bip49`
- `wallet:ufo-bip84`
- `wallet:zcoin-bip44`

## wallet:eos

```typescript
interface PrivateEosKey extends PrivateStorageKey {
  eosOwnerKey: string, // base16
  eosKey: string // base16
}

interface PublicEosKey {
  publicKey: string,
  ownerPublicKey?: string
}
```

## wallet:ethereum

```typescript
interface PrivateEthereumKey extends PrivateStorageKey {
  ethereumKey: string
}

interface PublicEthereumKey {
  publicKey: string // Hex address format
}
```

The `ethereumKey` field is either a 256-bit base16 encoded number, or a 12-word mnemonic seed. It may or may not have a `0x` prefix in front.

## wallet:monero

```typescript
interface PrivateMoneroKey extends PrivateStorageKey {
  moneroKey: string, // mnemonic phrase
  moneroSpendKeyPrivate: string,
  moneroSpendKeyPublic: string
}

interface PublicMoneroKey {
  moneroAddress: string,
  moneroViewKeyPrivate: string,
  moneroViewKeyPublic: string,
  moneroSpendKeyPublic: string
}
```

## wallet:ripple

```typescript
interface PrivateRippleKey extends PrivateStorageKey {
  rippleKey: string
}

interface PublicRippleKey {
  publicKey: string
}
```

## wallet:stellar

```typescript
interface PrivateStellarKey extends PrivateStorageKey {
  stellarKey: string
}

interface PublicStellarKey {
  publicKey: string
}
```
