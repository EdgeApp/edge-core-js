# edge-core-js

## 0.17.9 (2020-07-10)

- Restore sync failure messages in the UI

## 0.17.8 (2020-07-08)

- Allow the user to pass an `onLog` callback to the context constructor
  - This allows our CLI to silence the core and supports more flexibilty in GUI log handling
- Apply cleaners to the login stashes as well as remove some legacy disklet API usage
- Support date filters for `getTransactions`
- Save fee information in the spend metadata
- Send sync failures to the logs, not the UI
- Fix BSV replay protection feature broken by commit 11e752d8

## 0.17.7 (2020-07-03)

- Update info server URI
- Add bias for Coinmonitor exchange rate provider

## 0.17.6 (2020-06-16)

- Fix type annotations on some optional parameters that were accidentally marked as mandatory.
- Work around an issue in edge-currency-bitcoin that prevented spends from saving metadata.

## 0.17.5 (2020-06-11)

- Expose an `EdgeAccount.rootLoginId`.

## 0.17.4 (2020-06-02)

- Save the decryption keys for Monero spends (requires a matching Monero plugin change).
- Replace git2.airbitz.co with git1.edge.app in the sync server list.

## 0.17.3 (2020-05-26)

- Save transaction metadata with spends.
- Save an `EdgeTransaction.spendTargets` list with every spend.
- Save an optional `EdgeTransaction.swapData` field with swap transactions.

## 0.17.2 (2020-05-21)

- Prioritize the `wazirx` rate plugin when available.

## 0.17.1 (2020-05-07)

- Use constant-time comparisons for encryption & decryption.
- Upgrade redux-keto dependency & fix uncovered type errors.
- Improve git server error messages & rotation logic.

## 0.17.0 (2020-04-08)

This is a breaking release to address some issues in the swap API.

This release also renames all `pluginName` instances to `pluginId`. This affects all plugin types, but the core contains compatibility code so old currency plugins continue working (but not for rate or swap plugins, which are easier to just upgrade).

- Breaking changes to the swap API:
  - Return a new `EdgeSwapResult` structure from `EdgeSwapQuote.approve`. This now contains the `destinationAddress` and `orderId` that used to exist on the `EdgeSwapQuote` type.
  - Merge the `EdgeSwapPluginQuote` and `EdgeSwapQuote` types into one.
    - The `EdgeSwapQuote.isEstimate` flag is no longer optional, but must be `true` or `false`.
    - Remove `EdgeSwapQuote.quoteUri`. Just concatenate `EdgeSwapInfo.orderUri` with `EdgeSwapResult.orderId` to get this.
  - Rename `EdgeSwapInfo.quoteUri` to `orderUri`.
  - Remove the deprecated `plugins` option from `EdgeSwapRequestOptions`.

- Other breaking changes:
  - Remove deprecated `EdgeAccount.currencyTools`. Use `EdgeAccount.currencyConfig`.
  - Remove deprecated `EdgeAccount.exchangeTools`. Use `EdgeAccount.swapConfig`.
  - Remove deprecated `EdgeAccount.getExchangeQuote`. Use `EdgeAccount.fetchSwapQuote`.
  - Remove deprecated `EdgeAccount.pluginData`. Use `EdgeAccount.dataStore`.
  - Remove deprecated `EdgeIo.WebSocket`.

## 0.16.25 (2020-04-04)

- Prioritize swap providers with active promo codes.

## 0.16.24 (2020-03-04)

- Simplify the API for providing plugin swap promo codes.

## 0.16.23 (2020-03-03)

- Quick re-publish to fix Flow bug in previous release.

## 0.16.22 (2020-03-03)

- Fix the TypeScript type definitions.
- Add a way to prioritize different exchange-rate plugins.
- Add a way to pass promotion codes & disable swap providers on-the-fly while quoting.

## 0.16.21 (2020-02-05)

- Deprecate `pluginName` fields in favor of `pluginId`, which is a less confusing name.
- Add a way to pass a preferred plugin to `fetchSwapQuote`.

## 0.16.20 (2020-01-28)

- Add `EdgeCurrencyInfo.xpubExplorer`.

## 0.16.19 (2020-01-16)

- Record auth server failures in the log.

## 0.16.18 (2020-01-02)

- Type updates:
  - Deprecate `EdgeIo.console`.
  - Supply our own types for `EdgeIo.fetch`, which clarify our supported feature set.
  - Fix `EdgeOtherMethods` to be read-only.
- New features:
  - Pass a `log` method to plugins and engines.
  - Add an `EdgeIo.fetchCors` method on platforms that support it.
- Fixes:
  - Fix Edge login network error handling.
  - Use the `log` method internally, which changes our message format.

## 0.16.17 (2019-12-19)

- Work around a balance update bug.
- Add a `hidden` wallet state.

## 0.16.16 (2019-12-12)

- Generate TypeScript type definitions from the public Flow types.
- Add Flow type definitions to the error types.
- Perform the React Native polyfill more safely.

## 0.16.15 (2019-11-25)

- Add an `EdgeCurrencyWallet.changeEnabledTokens` method.

## 0.16.14 (2019-11-20)

- Save 2-factor keys sent back from the auth server.
- Expose the `recovery2Key` in `EdgeContext.localUsers`.

## 0.16.13 (2019-10-31)

- Include a default API key in the core, in case the user initializes the context with a blank `apiKey`.

## 0.16.12 (2019-10-23)

- Add a `currencyCode` to `InsufficientFundsError`.
- Update the readme with helpful information.

## 0.16.11 (2019-09-26)

- Fix swap quote prioritization logic to always prefer exact quotes.
- Add an `EdgeCurrencyConfig.importKey` method.
- Add optional properties to `EdgeCurrencyInfo`:
  - `canAdjustFees`
  - `canImportKeys`
  - `customFeeTemplate`
  - `customTokenTemplate`

## 0.16.10 (2019-09-20)

- De-duplicate dependencies.
- Enable minification on React Native builds.

## 0.16.9 (2019-09-05)

- Always prefer top-level currency codes over tokens, if there is a conflict.

## 0.16.8 (2019-08-26)

- Close unused swap quotes.
- Update YAOB correctly when plugin configurations change.
- Simplify the react-native WebView debug appearance.

## 0.16.7 (2019-08-14)

- Update linting and build tooling.
- Add a new `EdgeContext.paused` control for stopping background work.

## 0.16.6 (2019-08-02)

- Fix OTP settings to only apply to the root login.
- Add `close` events to Flow type definitions.
- Apply timeouts to the exchange-rate fetching logic.

## 0.16.5 (2019-07-22)

- Add polyfills for old React Native WebView implementations.
- Pass `otherParams` through the `EdgeCurrencyWallet` implementation.

## 0.16.4 (2019-06-25)

- Fix exchange-rate fetching again (for real this time?).

## 0.16.3 (2019-06-20)

- Fix exchange-rate fetching again.
- rn: Re-start the core when the `WebView` reloads.

## 0.16.2 (2019-06-10)

- Improve swap error-ranking logic.
- Make exchange-rate fetching more robust.

## 0.16.1 (2019-05-22)

- Indicate which swap quotes are only estimates, and de-prioritize those.

## 0.16.0 (2019-05-17)

Breaking changes:

- Remove swap plugins from core. These now live in the `edge-exchange-plugins` project.
- Tighten up spending-related Flow types

Fixes:

- Do not fail login when accounts contain broken Ethereum keys.

## 0.15.11 (2019-04-24)

- Support `react-native-webview` ^5.0.1.
- Pass custom tokens to currency plugin URI logic.
- Improve logging & error messages.
- Remove unused `EdgeSpendInfo` fields.

## 0.15.10 (2019-03-29)

- Do not let missing files crash `EdgeCurrencyWallet.getTransactions`.
- Fix a packaging error that would wrongly include `src/index.js` in the distribution.
- Work around bad Litecoin defaults in the bitcoin plugin.

## 0.15.9 (2019-03-27)

- Cache public keys at wallet start-up.
- Reduce logging related to missing fiat amounts.

## 0.15.8 (2019-03-22)

- Throttle wallet updates.
- Upgrade to disklet v0.4.0.
- Add an optional `EdgeCurrencyTools.importPrivateKey` method.

## 0.15.7

- Delay bridge crash

## 0.15.4 (2019-03-05)

- Harden the react-native WebView bridge to avoid crashes.
- Add Flow types for the plugin initialization functions.

## 0.15.3 (2019-02-26)

- Work around bugs in the Bitcoin plugin resulting in missing wallets.

## 0.15.2 (2019-02-22)

- Do not send rate plugin errors to `EdgeContext.on('error')`.

## 0.15.1 (2019-02-21)

- Fix out of range errors for ChangeNOW.
- Add a standalone `fetchLoginMessages` for react-native.
- Add a secret `unfilteredIndex` hack to `EdgeCurrencyWallet.getTransactions` to work around a missing transaction bug.
- Add an `EdgeCurrencyWallet.publicWalletInfo` property.

## 0.15.0 (2019-02-19)

This is a major release with large numbers of breaking changes for all platforms:

- Remove legacy type names.
- Remove legacy account and context callbacks.
- Remove `EdgeAccount.fetchSwapCurrencies`.
- Rename `EdgeSwapQuoteOptions` to `EdgeSwapRequest`.
- Replace `makeFakeEdgeContexts` with a new `makeFakeEdgeWorld` API.
- Replace `makeFakeIos` with `makeFakeIo`.
- Remove `error` namespace.
- Rework plugin loading:
  - Plugins must now provide their own networking and crypto.
  - The `addEdgeCorePlugins` / `lockEdgeCorePlugins` functions install plugins.
  - The `makeEdgeContext` function accepts a plain JSON plugin configuration object.
- Swap plugins:
  - Remove `pluginType` property
  - Remove `makeTools` method
  - Remove `EdgePluginEnvironment` & `EdgeSwapTools` types
  - Add `checkSettings` method & `EdgeSwapPluginStatus` type
  - Add `fetchSwapQuote` method
- Rate plugins:
  - Rename `EdgeExchangePairHint` to `EdgeRateHint`
  - Rename `EdgeExchangePair` to `EdgeRatePair`
  - Rename `EdgeExchangePlugin` to `EdgeRatePlugin`
  - Rename `exchangeInfo` to `rateInfo`
  - Rename `rateInfo.exchangeName` to `rateInfo.displayName`
  - Rename `fetchExchangeRates` to `fetchRates`
- Currency plugins:
  - In `EdgeCurrencyInfo`
    - Change `walletTypes` to `walletType`
    - Rename `currencyName` to `displayName`
  - In `EdgeCurrencyPlugin`
    - Rename `makeEngine` to `makeCurrencyEngine`
    - Move `changeUserSettings` to the engine.
    - Move all other features behind a `makeCurrencyTools` method & `EdgeCurrencyTools` type
    - Make methods fully async
      - `createPrivateKey`
      - `derivePublicKey`
      - `parseUri`
      - `encodeUri`
  - In `EdgeCurrencyEngineOptions`
    - Rename `optionalSettings` to `userSettings`
    - Remove legacy disklet
  - In `EdgeCurrencyEngine`
    - Remove unused options from `isAddressUsed` & `addGapLimitAddresses`
    - Remove `EdgeUnusedOptions` type
    - Remove `EdgeDataDump.pluginType`

For React Native in particular, we have the following changes:

- Replace `makeEdgeContext` with a `<MakeEdgeContext />` React component.
- Replace `makeFakeContexts` with a `<MakeFakeEdgeWorld />` React component.
- Remove `makeReactNativeIo`.
- The assets in `lib/react-native` need to be installed into the app bundle and pulled in via HTML:
  - Android: `file:///android_asset/edge-core/index.html`
  - iOS: `file://${main-bundle-path}/edge-core/index.html`
- Plugins need to be compiled as standalone scripts and installed in the same way.

## 0.14.0 (2019-02-12)

- Ship the library as debug-friendly ES 2018 code. Non-standard features like Flow are still transformed out.
- Add an `edge-core-js/types` entry point containing just Flow types.
- Remove `peerDependencies`, which was causing problems for users on platforms other than React Native.

## 0.13.8 (2019-02-10)

- Add `payinAddress` and `uniqueIdentifier` to swap metadata.

## 0.13.7 (2019-02-04)

- Fix `getTransactions` for compatibility with `edge-currency-accountbased` Ethereum.
- Fix AUD currency lookup bug.
- Clean up Flow types
  - Fix `EdgeGetTransactionsOptions.startEntries` type.
  - Add an `EdgePluginMap` helper type.
- Upgrade build tools to fix Travis.
- Fix `peerDependencies` spelling.
- Expose repo syncing through the secret internal API.

## 0.13.6

- Add Faa.st swap plugin.
- Log more steps during login.
- Upgrade to Flow v0.89.0.

## 0.13.5

- Upgrade to redux-pixies v0.3.6 to fix ghost wallets appearing at login.
- Sync the account keys during a `loginWithKey`.

## 0.13.4

- Fix `getTransactions` to return token transactions in the requested range.
- Fix ChangeNOW 400 errors.

## 0.13.3

- Fix ChangeNOW support email & quote URI.
- Add `EdgeSwapQuote.destinationAddress`.
- Re-apply replay protection when splitting BCH->BSV a second time.

## 0.13.2

- Fix ChangeNOW out of range errors.

## 0.13.1

- Add ChangeNOW swap plugin.

## 0.13.0

- Upgrade to disklet v0.3.0
  - Replace `folder` and `localFolder` with `disklet` and `localDisklet` in all API's to use the new Disklet API.
- Removed deprecated API's:
  - Renamed API's:
    - `EdgeCurrencyConfig.changePluginSettings` (use `changeUserSettings`)
    - `EdgeCurrencyConfig.changeSettings` (use `changeUserSettings`)
    - `EdgeCurrencyConfig.pluginSettings` (use `userSettings`)
    - `EdgeCurrencyConfig.settings` (use `userSettings`)
    - `EdgeSwapConfig.exchangeInfo` (use `swapInfo`)
    - `EdgeSwapConfig.settings` (use `userSettings`)
    - `EdgeSwapConfig.changeSettings` (use `changeUserSettings`)
    - `EdgeSwapCurrencies.exchanges` (use `pluginNames`)
    - `EdgeSwapQuote.exchangeService` (use `pluginName`)
  - Legacy swap API:
    - `EdgeCurrencyWallet.getQuote`
    - `EdgeContext.getExchangeSwapRate`
    - `EdgeContext.getExchangeSwapInfo`
- Upgraded to Disklet v0.3.0 API:
  - `EdgeAccount.folder` -> `EdgeAccount.disklet`
  - `EdgeAccount.localFolder` -> `EdgeAccount.localDisklet`
  - `EdgeCurrencyWallet.folder` -> `EdgeCurrencyWallet.disklet`
  - `EdgeCurrencyWallet.localFolder` -> `EdgeCurrencyWallet.localDisklet`
- Made `convertCurrency` async.
- Made `makeFakeContexts` async.
- Make `EdgeContextOptions.apiKey` & `EdgeContextOptions.appId` mandatory.
- Optimize the build system.

## 0.12.21

- Fixed an issue with `wallet.getTransactions()` that sometimes it wouldn't return the oldest transactions.
- Small cleanups and type fixes

## 0.12.20

- Fix the splitting/replay protection from Bitcoin Cash to Bitcoin SV
- Some flow fixes
- Add metadata to replay protection transactions
- Do not await on `reloadPluginSettings`, This prevents network roundtrips from blocking login. Upwards of 30s saved on really slow networks.

## 0.12.19

- When splitting from Bitcoin Cash to Bitcoin SV, preform a max spend to self to have replay protection before splitting the wallet

## 0.12.18

- Fix detecting and throwing of ShapeShift errors due to geo location or unverified accounts

## 0.12.17

- Improve `fetchSwapQuote` error hierarchy with rich information about different possible error conditions.

## 0.12.16

- Fix `getTransactions` from only returning a subset of transactions
- Fix swap exchange to gracefully fallback if one exchange errors
- Properly filter out a swap provider if they don't support a `getQuote` currency pair

## 0.12.12

- Do not call `makeEngine` on wallets which are archived or deleted

## 0.12.11

- Allow `createPrivateKey`, `derivePublicKey`, `parseUri`, and `encodeUri` methods from currency plugins to be async

## 0.12.10 (2018-11-02)

- Fix a potential crash on logout.
- Allow swap plugins to be disabled.
- Add `supportEmail` to `EdgeSwapInfo`.
- Fix swapping from coins with unique id's using Changelly.
- Log more swap steps.
- Upgrade to Disklet v0.2.8.

## 0.12.9

- Remove change to types of `createPrivateKey` and `derivePublicKey` due to Flow errors

## 0.12.8

- Fix throw when user account doesn't have a Shapeshift auth token

## 0.12.7

- Fix Changelly to use legacy addresses except for DGB

## 0.12.6

- Add denomination conversion helper routines.
- Add Changelly support to the swap API.

## 0.12.5

New:

- `EdgeSwapConfig.needsActivation` for exchanges that need KYC or other data.
- `EdgeSwapQuote.networkFee` for outgoing network fee.
- `SwapBelowLimitError` & `SwapAboveLimitError` for failed quotes.

Deprecations:

- `EdgeContext.getAvailableExchangeTokens`
- `EdgeContext.getExchangeSwapInfo`
- `EdgeContext.getExchangeSwapRate`
- `EdgeCurrencyWallet.getQuote`

Renames (old names deprecated):

- `EdgeAccount.currencyTools` -> `EdgeAccount.currencyConfig`
- `EdgeAccount.exchangeTools` -> `EdgeAccount.swapConfig`
- `EdgeAccount.getExchangeCurrencies` -> `EdgeAccount.fetchSwapCurrencies`
- `EdgeAccount.getExchangeQuote` -> `EdgeAccount.fetchSwapQuote`
- `EdgeCurrencyTools.settings` -> `EdgeCurrencyConfig.userSettings`
- `EdgeCurrencyTools.changeSettings` -> `EdgeCurrencyConfig.changeUserSettings`
- `EdgeExchangeQuote.exchangeSource` -> `EdgeSwapQuote.pluginName`
- `EdgeExchangeCurrencies.exchanges` -> `EdgeSwapCurrencies.pluginNames`

## 0.12.4

- Fix a packaging issue with the client-side methods.

## 0.12.3

- Move the client-side methods into their own file.

## 0.12.2

- Add a new Shapeshift API (still experimental & subject to change).
- Rename `EdgeCurrencyTools.pluginSettings` to `EdgeCurrencyTools.settings`.
- Rename `EdgeCurrencyTools.changePluginSettings` to `EdgeCurrencyTools.changeSettings`.

## 0.12.1

- Do not use legacy address for Digibyte when using ShapeShift

## 0.12.0

- Add a `waitForCurrencyWallet` helper.
- Work around 0 block-height problem with some currency plugins.
- Update to `yaob` 0.3.0. This one changes the timing on some callbacks a bit (breaking).

## 0.11.3

- Add a fake user with several test wallets.

## 0.11.2

- Hack around weird GUI Flow bug.

## 0.11.1

- Update the readme file.
- Work around a GUI crash.

## 0.11.0

- Make the core API bridgeable using Yaob.
- Add a private key hiding mode.
- Add a user list to the context object.

- Remove the ability to pass a node-style callback to any asynchronous API method instead of getting a promise.
- Fail earlier if the `apiKey` is missing.
- Rename `EdgeEdgeLoginRequest` to `EdgePendingEdgeLogin`

## 0.10.5

- Fix the git server list again.

## 0.10.4

- Fix the git server list.

## 0.10.3

- Upgrade disklet dependency.
- Add more git servers.

## 0.10.2

- Fix a type error that Flow somehow doesn't catch when run in this repo, but does catch when this library is in somebody else's `node_modules`.

## 0.10.1

- Expose the wallet sync ratio as a property
- Rename the account data store API
- Many, many code cleanups & fixes:
  - Fix an edge login race condition.
  - Do not allow users to delete logged-in accounts from disk.
  - Fix a hang if anything goes wrong creating wallets (redux-pixies upgrade).

## 0.10.0

- Remove deprecated context properties & options
- Remove `EdgeContext.io`
- Remove `EdgeContext.getCurrencyPlugins`
- Make many methods async:
  - `EdgeCurrencyWallet.getNumTransactions`
  - `EdgeAccount.listSplittableWalletTypes`
  - `EdgeCurrencyWallet.dumpData`
  - `EdgeCurrencyWallet.parseUri`
  - `EdgeCurrencyWallet.encodeUri`
- Add wallet properties for balances, block heights, and seeds

## 0.9.15

- Fix QBO & CSV export crash

## 0.9.14

- Another fix to QBO export 255-character limit (memo field)

## 0.9.13

- Pass options to `EdgeCurrencyPlugin.createPrivateKeys`.

## 0.9.12

- Fix QBO export error.
- Fix minor Flow bug.

## 0.9.11

- Upgrade Flow.
- Improve Flow types in currency wallet code.
- Fix bug where Edge could not edit Airbitz metadata.
- Add a basic `EdgeAccount.currencyTools` API.
- Fix QBO export bug.
- Fix more incorrect wallet key types.

## 0.9.10

- Add a `NoAmountSpecifiedError`.

## 0.9.9

- Fix a return value error in `listSplittableWalletTypes`.

## 0.9.8

- Fix Flow type bugs
- Fix incorrect platform detection on Web.

## 0.9.7

- Fix payment request Flow types.
- Implement plugin data API.

## 0.9.5

- Fix Edge login unhandled promise rejection error.
- Fix the Flow type for the transaction export denomination.
- Export the `Error` types directly.

## 0.9.4

- Fix Shapeshifting XMR and XRP.
- Add `EdgeCurrencyInfo.requiredConfirmations` and associated `PendingFundsError` types.

## 0.9.3

- Move the unit tests out of the `src` directory.

## 0.9.2

- Replace flow-copy-source with rollup-plugin-flow-entry to fix a packaging bug.
- Add `uniqueIdentifier` to `EdgeParsedUri`.

## 0.9.1

- Improve various flow typing issues, both inside and outside the core
- Add `getTxids` & related callback to the CurrencyEngine.

## 0.9.0-beta.1

- Auto-correct mis-typed 2fa secrets
- Expose `hmacSha256` for the CLI
- Fixed spelling mistake
- Storage and Wallet flow coverage
- Rename storage and exchange related files
- Change createPrivateKey and derivePublicKey to Object instead of {}
- Remove empty strings in the QBO export

## 0.8.1

- Flow type fix

## 0.8.0

- Add QBO & CSV export
- Add private key sweeping
- Add `EdgeCurrencyWallet.getNumTransactions`
- Remove deprecated methods
- Throttle wallet callbacks

## 0.7.2

- Do not crash on really long passwords when running in the web.

## 0.7.1

- Fix Edge login race conditions.

## 0.7.0

- Support Shapeshift precise transactions

## 0.6.7

- Do not report transactions that have been dropped

## 0.6.6

- Fix incorrect array dereference when saving transaction metadata

## 0.6.5

- Optimize getTransactions to only decrypt data for the range queried
- Prevent bitcoin segwit wallets from being split to bitcoin cash

## 0.6.3

- Add `legacyAddress` to `EdgeEncodeUri`

## 0.6.2

- Fix git sync on timer after login

## 0.6.1

- Fix wallet splitting issues
- Fix git syncing issues for large wallets
- Add a `listSplittableWaleltTypes` function

## 0.6.0

- Renamed the library to edge-core-js

## 0.5.6

- Fix build issues on React Native & web.
- Properly handle Shapeshift HTTP error codes.
- Add a `getAvailableExchangeTokens` function to the context.

## 0.5.5

- Fix login checksum errors exposed by previous release.
- Fall back on the app name for unnamed wallets.

## 0.5.4

- Fixes exchange rate multipliers for custom tokens.
- Handle plugin errors more gracefully.
- Make PIN changes fully recursive across all apps
- Allow the PIN to be enabled / disabled

## 0.5.3

- Fixes to Flow types, including brand-new flow types for `EdgeCurrencyWallet`.
- Fixes for Shapeshift spends (Bitcoin Cash addresses, proper fees).
- Redux state cleanups

## 0.5.2

- Fix accelerated crypto on React Native.

## 0.5.1

- Remove `core-js` polyfill. The main GUI needs to pull this in, if needed, since including it too late in the setup process can break React.
- Switch to `regenerator` instead of `nodent` for async / await support. This is slower but more compatible.

## 0.5.0

- Renamed the library to edge-login, massive development work.

## 0.3.5

Fixes:

- Logging into partner apps works again (round 2)

## 0.3.4

Fixes:

- Logging into partner apps works again

## 0.3.3

New:

- New plugin format
- Exchange rate cache
- `looginWithKey` method
- Store transaction metadata on first detection

Fixes:

- Code cleanup & reorganization
- Fixes to the transaction list
- Fixes to the transaction metadata format

Breaking changes:

- No longer expose the internal `login` or `loginTree` on the account.

## 0.3.2

New:

- Currency wallet support
- Wallet sort / archive / delete support
- Support for legacy wallet keys

Breaking changes:

- Fix the wallet id derivation algorithm

## 0.3.1

Fixes:

- The library explicitly depends on `buffer` now, fixing React Native
- Build system cleanups
- Many, many code cleanups

New:

- Error types all have a `name` property, which will replace the `type`
- Use the `disklet` library for all storage needs
- Expose `hashUsername` for the CLI

Breaking changes:

- api: Make `removeUsername` async
- The on-disk repo format has changed, requiring a re-sync

## 0.3.0

New:

- Accept the `io` object as a `makeContext` option

Breaking changes:

- Move the CLI tool to its own package
- api: Make `usernameAvailable` produce a bool
- api: Make `listUsernames` async
- api: Make `pinExists` & `pinLoginEnabled` async
- api: Remove deprecated exports
- api: Remove obsolete C++ error code system
- api: Remove platform-specific context constructors

## 0.2.1

- Make the auth server configurable
- Switch back to the production auth server by default

## 0.2.0

Breaking changes:

- Edge login v2
- New on-disk storage format

## 0.1.1

- Quick fix to package.json to exclude node-isms from the browser

## 0.1.0

Breaking changes:

- Make `checkPassword` async
- Remove `runScryptTimingWithParameters`

New:

- Add a `removeUsername` method to the context
- `makeContext` accepts a `random` function
- Add a `makeRandomGenerator` helper for RN
- Many CLI improvements
- Better error types

Fixes:

- Faster `scrypt`
- Switch to the `fetch` API
- Troublesome dependencies are now bundled and isolated

## 0.0.11

- Port project to ES2015

## 0.0.10

Fixes:

- Sync server rotation support
- HTTPS connections to sync servers
- Removed `asmcrypto.js`
- Made the CLI executable & installable
- Pruned the list of files we publish to NPM
