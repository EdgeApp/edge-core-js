# airbitz-core-js

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
