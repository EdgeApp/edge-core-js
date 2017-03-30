# airbitz-core-js

## 0.1.1

* Quick fix to pachage.json to exclude nodeisms from the browser

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
