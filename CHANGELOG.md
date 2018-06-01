# edge-core-js

## 0.9.0-beta.1
* Auto-correct mis-typed 2fa secrets
* Expose hmacSha256 for the CLI
* Fixed spelling mistake
* Storage and Wallet flow coverage
* Rename storeage ande exchange related files
* Change createPrivateKey and derivePublicKey to Object instead of {}
* Remove empty strings in the QBO export

## 0.8.1

* Flow type fix

## 0.8.0

* Add QBO & CSV export
* Add private key sweeping
* Add `EdgeCurrencyWallet.getNumTransactions`
* Remove deprecated methods
* Throttle wallet callbacks

## 0.7.2

* Do not crash on really long passwords when running in the web.

## 0.7.1

* Fix Edge login race conditions.

## 0.7.0

* Support Shapeshift precise transactions

## 0.6.7

* Do not report transactions that have been dropped

## 0.6.6

* Fix incorrect array dereference when saving transaction metadata

## 0.6.5

* Optimize getTransactions to only decrypt data for the range queried
* Prevent bitcoin segwit wallets from being split to bitcoin cash

## 0.6.3

* Add legacyAddress to EdgeEncodeUri

## 0.6.2

* Fix git sync on timer after login

## 0.6.1

* Fix wallet splitting issues
* Fix git syncing issues for large wallets
* Add a `listSplittableWaleltTypes` function

## 0.6.0

* Renamed the library to edge-core-js

## 0.5.6

* Fix build issues on React Native & web.
* Properly handle Shapeshift HTTP error codes.
* Add a `getAvailableExchangeTokens` function to the context.

## 0.5.5

* Fix login checksum errors exposed by previous release.
* Fall back on the app name for unnamed wallets.

## 0.5.4

* Fixes exchange rate multipliers for custom tokens.
* Handle plugin errors more gracefully.
* Make PIN changes fully recursive across all apps
* Allow the PIN to be enabled / disabled

## 0.5.3

* Fixes to Flow types, including brand-new flow types for EdgeCurrencyWallet.
* Fixes for Shapeshift spends (Bitcoin Cash addresses, proper fees).
* Redux state cleanups

## 0.5.2

* Fix accelerated crypto on React Native.

## 0.5.1

* Remove core-js polyfill. The main GUI needs to pull this in, if needed, since including it too late in the setup process can break React.
* Switch to regenerator instead of nodent for async / await support. This is slower but more compatible.

## 0.5.0

Renamed the library to edge-login, massive development work.

## 0.3.5

Fixes:
* Logging into partner apps works again (round 2)

## 0.3.4

Fixes:
* Logging into partner apps works again

## 0.3.3

New:
* New plugin format
* Exchange rate cache
* `looginWithKey` method
* Store transaction metadata on first detection

Fixes:
* Code cleanup & reorganization
* Fixes to the transaction list
* Fixes to the transaction metadata format

Breaking changes:
* No longer expose the internal `login` or `loginTree` on the account.

## 0.3.2

New:
* Currency wallet support
* Wallet sort / archive / delete support
* Support for legacy wallet keys

Breaking changes:
* Fix the wallet id derivation algorithm

## 0.3.1

Fixes:
* The library explicitly depends on `buffer` now, fixing React Native
* Build system cleanups
* Many, many code cleanups

New:
* Error types all have a `name` property, which will replace the `type`
* Use the `disklet` library for all storage needs
* Expose `hashUsername` for the CLI

Breaking changes:
* api: Make `removeUsername` async
* The on-disk repo format has changed, requiring a re-sync

## 0.3.0

New:
* Accept the `io` object as a `makeContext` option

Breaking changes:
* Move the CLI tool to its own package
* api: Make `usernameAvailable` produce a bool
* api: Make `listUsernames` async
* api: Make `pinExists` & `pinLoginEnabled` async
* api: Remove deprecated exports
* api: Remove obsolete C++ error code system
* api: Remove platform-specific context constructors

## 0.2.1

* Make the auth server configurable
* Switch back to the production auth server by default

## 0.2.0

Breaking changes:
* Edge login v2
* New on-disk storage format

## 0.1.1

* Quick fix to package.json to exclude nodeisms from the browser

## 0.1.0

Breaking changes:
* Make `checkPassword` async
* Remove `runScryptTimingWithParameters`

New:
* Add a `removeUsername` method to the context
* `makeContext` accepts a `random` function
* Add a `makeRandomGenerator` helper for RN
* Many CLI improvements
* Better error types

Fixes:
* Faster scrypt
* Switch to the `fetch` API
* Troublesome dependencies are now bundled and isolated

## 0.0.11

* Port project to ES2015

## 0.0.10

Fixes:
* Sync server rotation support
* HTTPS connections to sync servers
* Removed asmcrypto.js
* Made the CLI executable & installable
* Pruned the list of files we publish to NPM
