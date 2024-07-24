# edge-core-js

## Unreleased

## 2.9.1 (2024-07-24)

- fixed: Edge case for filtering transactions with empty txs (zero amount & fee)

## 2.9.0 (2024-07-22)

- added: Add `makeMemoryWallet` method to ephemeral wallet objects that can query balances and spend funds

## 2.8.2 (2024-07-22)

- fixed: Correctly handle `null` fetch bodies on Android.

## 2.8.1 (2024-07-11)

- fixed: Filter transactions with empty (zero) nativeAmount and networkFee

## 2.8.0 (2024-07-09)

- changed: Replace the CORS proxy servers with a fully native fallback on React Native.

## 2.7.0 (2024-06-10)

- added: New `enableRbf` field on `EdgeSpendInfo`
- changed: Deprecated `rbfTxid` field on `EdgeSpendInfo`

## 2.6.1 (2024-05-23)

- fixed: Add missing Swift import statement.

## 2.6.0 (2024-05-21)

- added: Better documentation comments for the `EdgeObjectTemplate` types.
- changed: Expose the `EdgeTransaction.feeRateUsed` provided by the engine, and only use the on-disk copy as a fallback.

## 2.5.0 (2024-03-29)

- added: `EdgeContextOptions.airbitzSupport`, for loading legacy Airbitz data from disk.
- fixed: Export the `EdgeObjectTemplate` type.
- fixed: TypeScript v5 compatibility.

## 2.4.0 (2024-03-25)

- added: New `'failed'` value to confirmations field on `EdgeTransactions`

## 2.3.0 (2024-03-23)

- added: `EdgeCorePluginOptions.infoPayload`, containing arbitrary JSON provided by the info server.
- added: `EdgeCurrencyPlugin.updateInfoPayload`, called when we the core fetches a fresh payload from the info server.

## 2.2.1 (2024-02-21)

- fixed: Correctly save `enabledTokenIds` when creating a new wallet.

## 2.2.0 (2024-02-12)

- added: Accept an `enabledTokens` parameter to the `createCurrencyWallets` method.

## 2.1.1 (2024-02-02)

- fixed: Token activation causing error and insufficient funds when used with core 1.x plugins

## 2.1.0 (2024-01-18)

- added: Make swap timeouts adjustable.
- fixed: Provide a `currencyCode` fallback to `EdgeCurrencyEngine.getMaxSpendable`.

## 2.0.1 (2024-01-08)

- added: Missing asset action types (claim, claimOrder, swapNetworkFee, and transferNetworkFee).
- fixed: Avoid superfluous property updates.
- fixed: Correctly populate `tokenId` on `makeSpend` when using legacy currency plugins.
- fixed: Correctly write `assetAction` to disk.

## 2.0.0 (2024-01-04)

- added: `EdgeCurrencyWallet.saveTxAction` to add/edit `EdgeTransaction.savedAction`
- added: `EdgeTransaction.assetAction` & `EdgeSpendInfo.assetAction` for action info that is saved per token in a transaction.
- added: `EdgeTransaction.savedAction` & `EdgeSpendInfo.savedAction` as editable version of `chainAction`
- added: `EdgeTxActionFiat` action type for fiat buy/sells
- added: `EdgeTxActionTokenApproval` action type for token approval transactions
- changed: Extend `EdgeTxActionSwap` to fully replace `EdgeSwapData`
- changed: Make `EdgeCurrencyInfo.defaultSettings` and `EdgeCurrencyInfo.metaTokens` optional.
- changed: Rename `EdgeTransaction.action` to `chainAction`
- changed: Require `tokenId` to be null or string and eliminate `currencyCode` in `EdgeCurrencyWallet.getTransactions/getReceiveAddress`, `EdgeSpendInfo`, `EdgeSwapRequest`, `EdgeTxAction.EdgeAssetAmount`, `saveTxMetadata`
- removed: `EdgeAccount.rateCache` and related types, as well as the rate plugin concept.
- removed: `EdgeContext.deleteLocalAccount`
- removed: `EdgeContext.listUsernames`
- removed: `EdgeContext.pinLoginEnabled`
- removed: `EdgeCurrencyInfo.symbolImage` and `symbolImageDarkMono`.
- removed: `EdgeLoginRequest.displayImageUrl`
- removed: `listRecoveryQuestionChoices` and related types.
- removed: `validateMemo` methods and related types.

## 1.14.0 (2024-01-04)

- added: `EdgeCurrencyCodeOptions.tokenId`. This upgrades `getBalance`, `getNumTransactions`, and `getReceiveAddress`.
- added: `EdgeCurrencyEngineCallbacks.onTokenBalanceChanged`, which is thew new balance-update callback.
- added: `EdgeCurrencyWallet.balanceMap`, which reports balances by tokenId.
- added: `EdgeParsedUri.tokenId`
- added: `EdgeTokenId` type definition.
- added: `EdgeTransaction.tokenId`.
- added: Allow deleting metadata fields by passing `null` to `saveTxMetadata`.
- deprecated: `EdgeCurrencyEngineCallbacks.onBalanceChanged`. Use `onTokenBalanceChanged` instead.
- deprecated: `EdgeParsedUri.currencyCode`. Use `tokenId` instead.
- deprecated: `EdgeTransaction.currencyCode`. Use `tokenId` instead.

## 1.13.1 (2023-12-06)

- added: Extra cors servers to distribute load

## 1.13.0 (2023-12-05)

- added: `EdgeAccount.createCurrencyWallets`, for creating multiple wallets at once.

## 1.12.0 (2023-11-30)

- added: Accept an `onNewTokens` callback from `EdgeCurrencyEngine`.
- added: Emit an `enabledDetectedTokens` event when auto-enabling tokens.
- added: Expose auto-detected tokens as `EdgeCurrencyWallet.detectedTokenIds`.
- changed: Save enabled tokens by their tokenId, not by their currency code.
- fixed: Add missing `export` to the `EdgeCorePluginFactory` type definition.

## 1.11.0 (2023-10-18)

- added: `EdgeAccount.fetchSwapQuotes`, to return all relevant quotes, and not just the best one.

## 1.10.0 (2023-10-10)

- added: `EdgeTransaction.action` to tag known smart contract transaction types (swap, stake, etc.).

## 1.9.0 (2023-10-10)

- added: Support optimized login syncing, checking to see if our credentials are up-to-date before performing a periodic login.

## 1.8.0 (2023-10-02)

- added: Export cleaners for server types and testing data types.
- deprecated: `EdgeContext.listRecoveryQuestionChoices`. The GUI provides its own localized strings now.

## v1.7.0 (2023-09-12)

- added: Add a `ChallengeError` and related types, which will allow the login server to request CAPTCHA validation.
- fixed: Correctly pass `EdgeSpendTarget.memos` through to currency plugins.
- fixed: Do not let `EdgeTransaction.memos` be undefined, even for legacy plugins.
- fixed: Restore "0x" prefix support for legacy hex memos.

## v1.6.0 (2023-09-11)

- added: Currency-info support for multiple memos per transaction.
  - added: `EdgeCurrencyInfo.memoOptions`, lists acceptable memo types.
  - added: `EdgeCurrencyInfo.multipleMemos`, set if a currency supports multiple memos in the same transaction.
  - deprecated: `EdgeCurrencyInfo.memoMaxLength`
  - deprecated: `EdgeCurrencyInfo.memoMaxValue`
  - deprecated: `EdgeCurrencyInfo.memoType`. Note: If it is not set correctly, legacy plugins will no longer receive memos. Some buggy plugins forgot to do this, so those plugins will stop receiving memos. This is not a breaking change, though, since this field was always mandatory.
- added: Spending support for multiple memos.
  - added: `EdgeSpendInfo.memos`
  - deprecated: `EdgeSpendTarget.memo`
- added: Transaction history support for on-chain memos.
  - added: `EdgeTransaction.memos`
  - deprecated: `EdgeTransaction.spendTargets.memo`

## v1.5.0 (2023-09-06)

- added: New infoServer and syncServer options for EdgeContextOptions

## v1.4.2 (2023-08-16)

- fixed: Allow PIN changes on accounts without usernames.
- changed: Change the `error` event type to `any`. This will become `unknown` in a future breaking release.

## v1.4.1 (2023-08-16)

- changed: Reduced YAOB throttle to 50ms and apply throttle to return bridge calls

## v1.4.0 (2023-08-08)

- added: canBePartial and maxFulfillmentSeconds to EdgeSwapQuote
- added: skipBlockHeight config option

## v1.3.7 (2023-08-03)

- changed: Throttle the react-native bridge to 500ms. This will create some lag, but should improve overall performance.
- changed: Move the Android namespace definition out of the `AndroidMaifest.xml` and into the `build.gradle` file.

## v1.3.6 (2023-08-01)

- fixed: Interpret HTTP 418 responses from the CORS proxy as errors.

## v1.3.5 (2023-07-26)

- changed: Remove `fetch` fallback logic. No proxy servers will be used.
- changed: The `fetchCors` method is no longer deprecated. Use this if CORS might be an issue. Do _not_ use this for any secrets or credentials.

## v1.3.4 (2023-07-26)

- fixed: Escape bridge strings closer to serialization, for possibly better performance.
- fixed: Fallback to CORS-safe fetch functions on all errors to fix inconsistency with error messages across platforms.

## v1.3.3 (2023-07-24)

- changed: Add fallback to bridged `fetch` if request to edge-cors-proxy server fails.

## v1.3.2 (2023-07-13)

- changed: Added a fallback to edge-cors-proxy server to `fetch` method on `EdgeIo`.

## v1.3.1 (2023-07-11)

- fixed: Enable WebView debugging on iOS 16.4+
- fixed: Correctly return transactions after a resync.

## v1.3.0 (2023-06-16)

- added: Add an `EdgeAccount.getPin` method.
- fixed: Allow the `EdgeAccount.username` property to update after calling `changeUsername`.

## v1.2.0 (2023-06-15)

- added: Add an `EdgeCurrencyWallet.streamTransactions` method.
- deprecated: Pagination options for `getTransactions`. Use `streamTransactions` if you need pagination.
- fixed: Add the correct URI to `changeUsername`, so it works.
- fixed: Send a 'transactionsChanged' event when editing metadata.

## v1.1.0 (2023-06-08)

- added: Add an `EdgeContext.forgetAccount` method.
- deprecated: `EdgeContext.deleteLocalAccount`. Use `EdgeContext.forgetAccount` instead.
- fixed: Do not throw a "No username in reply" error when logging into light accounts via barcode.

## v1.0.1 (2023-06-01)

- fixed: Do not crash when accessing `EdgeAccount.username` on an account that has none.

## v1.0.0 (2023-06-01)

- changed: Convert `createAccount` to named parameters
- changed: Return an array from `fetchLoginMessages`
- changed: Fix the `listRecoveryQuestionChoices` return type
- changed: Allow usernames to be `undefined`
- removed: Ethereum hacks
  - Ethereum address derivation.
  - `EdgeAccount.signEthereumTransaction`
- removed: Deprecated client-side token methods
  - `EdgeCurrencyEngine.getEnabledTokens` (no longer used)
  - `EdgeCurrencyEngine.getTokenStatus` (no longer used)
  - `EdgeCurrencyWallet.addCustomToken`
  - `EdgeCurrencyWallet.changeEnabledTokens`
  - `EdgeCurrencyWallet.disableTokens`
  - `EdgeCurrencyWallet.enableTokens`
  - `EdgeCurrencyWallet.getEnabledTokens`
- removed: Deprecated display-key properties
  - `EdgeCurrencyWallet.displayPrivateSeed`
  - `EdgeCurrencyWallet.displayPublicSeed`
- removed: Deprecated `EdgeAccount.loginKey` property
- removed: Deprecated `keys` properties on `EdgeAccount` and `EdgeCurrencyWallet`
- removed: Deprecated `EdgeTransaction.amountSatoshi`
- removed: Deprecated `options` prop from the `MakeEdgeContext` component.
- removed: Unused `EdgeTransaction.wallet`
- removed: Unused `getTransactions` parameters
- removed: Unused type definitions
  - `EdgeBitcoinPrivateKeyOptions`
  - `EdgeCreatePrivateKeyOptions`
- removed: No longer allow the OTP key to be passed as `EdgeAccountOptions.otp`. This parameter only accepts 6-digit OTP codes now. Pass the key as `EdgeAccountOptions.otpKey` instead.

## v0.21.5 (2023-05-24)

- deprecated: `EdgeContext.pinLoginEnabled`. Use `EdgeContext.localUsers` instead.
- fixed: Correctly handle `startEntries` in `getTransactions`, by always returning the requested number of transactions.

## v0.21.4 (2023-05-24)

- added: `EdgeAccount.changeUsername`.
- added: `EdgeAccount.getLoginKey`.
- deprecated: `EdgeAccount.loginKey`. Use `EdgeAccount.getLoginKey` instead.
- deprecated: `EdgeContext.listUsernames`. Use `EdgeContext.localUsers` instead.

## v0.21.3 (2023-05-09)

- fixed: Return transactions from getTransactions, even if they have no on-disk metadata
- changed: Remove deprecated methods in unit tests

## v0.21.1-1 (2023-05-09)

- fixed: Return transactions from getTransactions, even if they have no on-disk metadata

## v0.21.2 (2023-05-02)

- added: `EdgeUserInfo.username`.
- added: Provide `EdgeAccount` methods for reading public and private keys:
  - `getDisplayPrivateKey`
  - `getDisplayPublicKey`
  - `getRawPrivateKey`
  - `getRawPublicKey`
- added: Matching `EdgeCurrencyTools` methods for getting display keys.
- deprecated: `EdgeCurrencyEngine` methods for getting display keys.
- deprecated: `EdgeAccount` and `EdgeCurrencyWallet` key properties.

## v0.21.1 (2023-04-24)

- added: Log any swap plugins that time out.

## v0.21.0 (2023-04-19)

- added: `EdgeParsedUri.minNativeAmount`. Note: This is not a breaking change, but we incorrectly updated the version number as if it were.

## v0.20.2 (2023-04-13)

- fixed: Stop incorrectly writing metadata for sends. This should make editing metadata more stable.

## v0.20.1 (2023-04-12)

- fixed: Remove check that spentTargets.length > 0 in makeSpend

## v0.20.0 (2023-04-10)

- changed: Removed private keys from `walletInfo` for `makeCurrencyEngine`
- added: Add an `EdgeTransaction.isSend` flag.

## v0.19.50 (2023-04-12)

- fixed: Remove check that spentTargets.length > 0 in makeSpend

## v0.19.49 (2023-03-30)

- fixed: Incorrectly formed `privateKeys` argument for `signTx` call to the engine

## v0.19.48 (2023-03-27)

- fixed: Passing only the private keys to `EdgeEnginePrivateKeyOptions['privateKeys']` for `syncNetwork`, instead of the entire `EdgeWalletInfo`

## v0.19.47 (2023-03-27)

- added: Pass private keys to `EdgeCurrencyEngine.signTx` and similar functions.
- changed: Only accept base-10 integer balances from currency engines, and ignore all other balance strings.
- removed: Make deprecated token methods optional on `EdgeCurrencyEngine`, so they can be removed.

## v0.19.46 (2023-03-07)

- added: Add `expireDate` to `EdgeParsedUri`

## v0.19.45 (2023-03-02)

- fixed: Update `denominationToNative` and `nativeToDenomination` to look at `allTokens`, instead of the legacy token lists.

## v0.19.44 (2023-02-28)

- added: `EdgeAccount.currencyEngineErrors` - these are set for wallets that fail to load.
- added: `EdgeAccount.waitForAllWallets()` - resolves once all wallets have either loaded or failed (but balances may still be syncing).

## v0.19.43 (2023-02-23)

- added: Provide login request images for both dark & light mode apps as `EdgeLoginRequest.displayImageDarkUrl` and `EdgeLoginRequest.displayImageDarkUrl`.
- added: `EdgeFakeContextOptions.allowNetworkAccess`, which allows non-Edge traffic to pass through to the real network.
- added: `EdgeWalletInfoFull.migratedFromWalletId`, which can be saved when sweeping funds from an old wallet to a new wallet.
- deprecated: `EdgeLoginRequest.displayImageUrl`. Use the new dark or light mode images instead.

## v0.19.42 (2023-02-02)

- added: Support for token activation

## v0.19.41 (2023-01-26)

- changed: Convert source code to TypeScript internally. No changes should be visible externally, aside from some file locations.

## v0.19.40 (2023-01-24)

- added: New 'syncing' to confirmations API
- fixed: Bug in `validateConfirmations` function incorrectly inferring a transaction as 'dropped'

## v0.19.39 (2023-01-17)

- fixed: Re-publish with missing files.

## v0.19.38 (2023-01-17)

- changed: Make sensitive account & wallet properties, like keys, non-enumerable.
- changed: Use the pluginId as the wallet logging prefix, instead of the currency code.

## v0.19.37 (2023-01-06)

- added: Always-enabled tokens. The currency engine checks these for balances and transactions, but they do not appear in the per-wallet enabled token lists.
  - `EdgeCurrencyConfig.alwaysEnabledTokenIds`
  - `EdgeCurrencyConfig.changeAlwaysEnabledTokenIds`
- added: `EdgeCurrencyTools.checkPublicKey`, which provides a mechanism for currency plugins to refresh their cached public keys if necessary.
- added: `EdgeSwapInfo.isDex` and `EdgeSwapRequestOptions.preferType`, to always prefer DEX swaps over centralized swaps.
- changed: Always select the "transfer" plugin if it returns a quote, regardless of price.

## v0.19.36 (2022-12-26)

- added: Accelerate Transaction API

## v0.19.35 (2022-12-20)

- fixed: Clean swap quotes before logging to prevent circular reference error

## v0.19.34 (2022-12-16)

- fixed: Export more accurate TypeScript definitions for our React Native components.

## v0.19.33 (2022-11-25)

- added: New options for getReceiveAddress
- changed: Upgrade biggystring to 4.0.0
- changed: Increase BCH replay protection transaction value amount
- changed: Upgrade redux to 4.2.0
- changed: Upgrade redux-keto to 0.3.5
- fixed: Login server override testing

## v0.19.32 (2022-11-14)

- added: `EdgeTransaction.walletId`.
- added: Add the swap request to the quote object as `EdgeSwapQuote.request`.
- changed: Change login server to login.edge.app, and filter which domains we allow.
- deprecated: `EdgeTransaction.wallet`. Use `EdgeTransaction.walletId` instead.

## v0.19.31 (2022-11-02)

- added: Specifying token spends by their ID, instead of their imprecise currency code:
  - `EdgeSpendInfo.tokenId`
  - `EdgeSwapRequest.fromTokenId`
  - `EdgeSwapRequest.toTokenId`
- deprecated: Spending tokens by their currency code.
  - `EdgeSpendInfo.currencyCode`
  - `EdgeSwapRequest.fromCurrencyCode`
  - `EdgeSwapRequest.toCurrencyCode`

## v0.19.30 (2022-09-22)

- fixed: Correctly pass `EdgeSpendInfo.pendingTxs` to the currency plugin.

## v0.19.29 (2022-09-13)

- added: Include the `loginId` in `EdgeContext.localUsers`.
- added: Accept an optional metadata parameter to `EdgeSwapQuote.approve`.

## v0.19.28 (2022-09-02)

- added: `hex` option for memoType

## v0.19.27 (2022-08-25)

- fixed: Correctly pass `EdgeSpendInfo.skipChecks` to the currency plugin.

## v0.19.26 (2022-08-19)

- added: `EdgeContext.clientId`.
- added: `EdgeSpendInfo.pendingTxs` and `EdgeSpendInfo.skipChecks` flags.
- fixed: Show useful information when logging errors, instead of just `{}`.

## v0.19.25 (2022-07-27)

- changed: Allow individual plugins to resist being loaded by returning `undefined` instead of an `EdgeCurrencyPlugin` object.

## v0.19.24 (2022-07-26)

- changed: Randomly generate loginIds so recycled usernames don't cause conflicts
- fixed: Upgrade edge-sync-client to include patch

## v0.19.23 (2022-07-13)

- added: Add optional from/to parameter to min and max swap errors

## v0.19.22 (2022-07-08)

- upgrade: yaob dependency to include error serialization fix

## v0.19.21 (2022-07-05)

- added: New `deleteRemoteAccount` function to the `EdgeAccount` object

## v0.19.20 (2022-06-22)

- fixed: Loosen constraint for checking tx confirmation status in 'getTransaction' and Make the condition identical to the condition in onBlockHeightChanged.

## v0.19.19 (2022-06-13)

- added: New Confirmations API on `EdgeTransaction` type

## v0.19.18 (2022-05-19)

- fixed: Do not uselessly re-save the custom tokens on every login.

## v0.19.17 (2022-05-18)

- fixed: Correctly load custom tokens (regression from last release).

## v0.19.16 (2022-05-16)

- fixed: Correctly load tokens from the legacy settings file.
- fixed: Correctly report errors when adding invalid custom tokens.

## v0.19.15 (2022-05-02)

- added: `EdgeCurrencyConfig.allTokens`.
- fixed: Do not erroneously enable tokens when editing their currency codes.

## v0.19.14 (2022-04-26)

- fixed: Never return `undefined` for `EdgeCurrencyConfig.customTokens`.
- fixed: Handle token edits that change the `tokenId` or `currencyCode`.
- removed: Do not treat parent currencies as tokens. This logic was unused, so update the documentation.

## v0.19.13 (2022-04-05)

- added: `EdgeCurrencyWallet.currencyConfig`.
- changed: Save custom tokens to disk.
  - added: `EdgeCurrencyConfig.addCustomToken`.
  - added: `EdgeCurrencyConfig.changeCustomToken`.
  - added: `EdgeCurrencyConfig.removeCustomToken`.
  - deprecated: `EdgeCurrencyWallet.addCustomToken`.
- changed: Save enabled tokens to disk.
  - added: `EdgeCurrencyWallet.changeEnabledTokenIds`
  - added: `EdgeCurrencyWallet.enabledTokenIds`
  - deprecated: `EdgeCurrencyWallet.changeEnabledTokens`
  - deprecated: `EdgeCurrencyWallet.disableTokens`
  - deprecated: `EdgeCurrencyWallet.enableTokens`
  - deprecated: `EdgeCurrencyWallet.getEnabledTokens`
- changed: Update the token API for currency plugins. Plugins should implement the new methods, then turn the old methods to no-ops.
  - added: Optional `EdgeCurrencyEngine.changeCustomTokens`
  - added: Optional `EdgeCurrencyEngine.changeEnabledTokenIds`
  - added: Optional `EdgeCurrencyTools.getTokenId`
  - deprecated: `EdgeCurrencyEngine.addCustomToken`
  - deprecated: `EdgeCurrencyEngine.disableTokens`
  - deprecated: `EdgeCurrencyEngine.enableTokens`
  - deprecated: `EdgeCurrencyEngine.getEnabledTokens`
  - deprecated: `EdgeCurrencyEngine.getTokenStatus`

## v0.19.12 (2022-04-01)

- fixed: Avoid an internal crash on logout while reloading addresses.
- fixed: Make our code compatible with older Java versions again.
- fixed: Use the correct React dependency in the iOS podspec.
- changed: Allow individual log sources to be set to `silent`.
- changed: Move some string manipulations off of the main Java thread.

## v0.19.11 (2022-03-18)

- changed: Perform React Native disk accesses on their own threads.

## v0.19.10 (2022-03-02)

- added: `EdgeCurrencyInfo.canReplaceByFee`.
- changed: Make `denominationToNative` and `nativeToDenomination` only look at the currencies available on the current wallet.

## v0.19.9 (2022-02-22)

- fixed: Stop adding `undefined` entries to `EdgeAccount.currencyWallets`.

## v0.19.8 (2022-02-21)

- added: Define a new `EdgeToken` type and make that available as `EdgeCurrencyConfig.builtinTokens` and `EdgeCurrencyConfig.customTokens`.
- added: Define a new `EdgeCurrencyPlugin.getBuiltinTokens` method, and use that to populate `EdgeCurrencyConfig.builtinTokens` when available.
- added: Pass `EdgeToken` fields to `EdgeCurrencyEngine.addCustomToken`, along with the existing `EdgeMetaToken` fields.
- deprecated: `EdgeCurrencyInfo.defaultSettings`
- deprecated: `EdgeCurrencyInfo.metaTokens`
- deprecated: `EdgeCurrencyInfo.symbolImage`
- deprecated: `EdgeCurrencyInfo.symbolImageDarkMono`

## v0.19.7 (2022-02-15)

- added: Include an `imported` flag with all new wallet keys, to indicate whether they were derived freshly or imported from user-entered data.
- fixed: Do not hang forever if creating a currency engine fails.

## v0.19.6 (2022-02-10)

- changed: Add comments and improve organization in the public types file.
- changed: Use cleaners to load & save many files for additional safety.
- fixed: Improve wallet start-up performance by loading fewer files.

## v0.19.5 (2022-02-04)

- changed: Send the optional `keyOptions` parameter through the `importKey` methods.
- fixed: Remove JCenter from the Android build file.

## v0.19.4 (2022-01-28)

- added: `EdgeCurrencyWallet.stakingStatus`, along with matching engine methods for returning and updating this.
- fixed: Removed unnecessary C++ compiler flags.

## v0.19.3 (2022-01-21)

- fixed: Correctly select swaps with the best price.
- fixed: Correctly prefer swap plugins with active promo codes.
- changed: Add more logging to the swap procedure.

## v0.19.2 (2022-01-20)

- fixed: Only write the `deviceDescription` on sent transactions.
- fixed: Add a native `requiresMainQueueSetup` method to silence a warning on iOS.

## v0.19.1 (2022-01-14)

- changed: Write files atomically on Android, so out-of-disk and other errors do not lead to data corruption.
- fixed: Upgrade edge-sync-client, so info server errors are no longer fatal.
- fixed: Do not destroy the core WebView when opening Safari links on iOS.

## v0.19.0 (2022-01-11)

This release completely changes the way React Native works, both to improve performance and to make integration and debugging much easier.

- changed: Simplify the React Native integration to "just work".
  - Stop depending on external libraries such as react-native-fast-crypto, react-native-randombytes, or react-native-webview.
  - Use React Native auto-linking to integrate all native code, HTML, and Javascript needed to run the core.
  - Accept core plugins via a `pluginUris` prop to `MakeEdgeContext` or `MakeFakeEdgeWorld`.
  - Allow core debugging by running `yarn start` in this repo to start a dev server, and then setting the `debug` prop to true.
  - Accept an `allowDebugging` prop on Android to enable WebView debugging in general (useful for debugging plugins).
- changed: Require `EdgeCurrencyEngine` methods to return promises.
- changed: Mark methods as `readonly` in the TypeScript definitions, to match what Flow was already doing.

## v0.18.14 (2021-01-06)

- fixed: Allow logins with an appId to approve or reject vouchers.
- added: Allow maximum swaps by passing "max" to `EdgeSwapRequest.quoteFor`.
- added: Add an `EdgeCurrencyEngine.getMaxSpendable` method for native max-spend calculations.

## v0.18.13 (2021-12-17)

- added: `EdgeSpendTarget.memo`, which is a renamed version of `EdgeSpendTarget.uniqueIdentifier`.
- added: `EdgeCurrencyInfo.memoType`, `EdgeCurrencyInfo.memoMaxLength`, `EdgeCurrencyInfo.memoMaxValue`. Use these to learn which currencies support memos.
- added: `EdgeCurrencyTools.validateMemo` & `EdgeCurrencyWallet.validateMemo`. Use these to check memos for validity before sending.
- deprecated: `EdgeSpendTarget.uniqueIdentifier`. Use `EdgeSpendTarget.memo` instead.

## v0.18.12 (2021-12-10)

- fixed: Gracefully handle errors while reading the exchange-rate hint cache.
- fixed: Correctly match server-returned children with their on-disk stash entries. This produces more accurate errors if the server loses a child.

## v0.18.11 (2021-11-07)

- fixed: onWcNewContractCall callback type
- fixed: Bitcoin and Bitcoin xpub documentation

## v0.18.10 (2021-11-02)

- added: Implement TypeScript utilities in Flow
- added: Wallet Connect types and onWcNewContractCall callback
- updated: Ethereum, Bitcoin, and Bitcoin xpub documentation
- fixed: Type-safety and null checks

## v0.18.9 (2021-09-21)

- fixed: Allow `import 'edge-core-js/types'` to work in TypeScript.

## v0.18.8 (2021-09-17)

- changed: Upgrade cleaners to v0.3.11
- fixed: Restore Webpack production mode

## 0.18.7 (2021-09-10)

- fixed: Limit the number of documents uploaded to the sync server in one request.
- fixed: Upgrade to edge-sync-client v0.2.1, which improves the sync-server retry logic.

## 0.18.6 (2021-09-08)

- changed: Use edge-sync-client to retrieve the list of sync servers instead of a hard-coded list.

## 0.18.5 (2021-08-17)

- fixed: If multiple metadata files exist for a single transaction, always load the oldest one.

## 0.18.4 (2021-08-02)

- fixed: Ensure that transactions never have `undefined` as a `nativeAmount`.
- fixed: Change the WebPack build settings to allow easier debugging.

## 0.18.3 (2021-07-26)

- fixed: Fix the React Native WebView bundle to work on really old devices.

## 0.18.2 (2021-06-21)

- Replace nullish coalescing operator with ternary

## 0.18.1 (2021-06-18)

- added: Save the device description on sent transactions.
- added: Add an optional `InsufficientFundsError.networkFee` field.
- fixed: Avoid performing back-to-back initial syncs.

## 0.18.0 (2021-05-25)

This is a breaking release to remove various deprecated features that have accumulated.

- Remove several methods and properties:
  - `EdgeAccount.exchangeCache` - Use `EdgeAccount.rateCache` instead.
  - `EdgeContext.getRecovery2Key` - Use `EdgeUserInfo.recovery2Key` instead.
  - `EdgeContext.pinExists` - Use `EdgeUserInfo.pinLoginEnabled` instead.
  - `EdgeContext.on('login')` - Use `EdgePendingEdgeLogin.watch('account')` instead.
  - `EdgeContext.on('loginError')` - Use `EdgePendingEdgeLogin.watch('error')` instead.
  - `EdgeContext.on('loginStart')` - Use `EdgePendingEdgeLogin.watch('username')` instead.
  - `EdgeCurrencyWallet.exportTransactionsToCSV` - Moved to edge-react-gui project.
  - `EdgeCurrencyWallet.exportTransactionsToQBO` - Moved to edge-react-gui project.
  - `EdgeCurrencyWallet.getBalance` - Use `EdgeCurrencyWallet.balance` instead.
  - `EdgeCurrencyWallet.getBlockHeight` - Use `EdgeCurrencyWallet.blockHeight` instead.
  - `EdgeCurrencyWallet.getDisplayPrivateSeed` - Use `EdgeCurrencyWallet.displayPrivateSeed` instead.
  - `EdgeCurrencyWallet.getDisplayPublicSeed` - Use `EdgeCurrencyWallet.displayPublicSeed` instead.
  - `EdgeCurrencyWallet.startEngine` - Use `EdgeCurrencyWallet.changePaused(false)` instead.
  - `EdgeCurrencyWallet.stopEngine` - Use `EdgeCurrencyWallet.changePaused(true)` instead.
  - `EdgeEncodeUri.legacyAddress` - Use `EdgeEncodeUri.publicAddress` instead.
  - `EdgeEncodeUri.segwitAddress` - Use `EdgeEncodeUri.publicAddress` instead.
- Remove the `options` prop on the `MakeEdgeContext` React Native component.
  - Just pass any context options as normal props.
- Remove the `type` property from all error classes, as well as the global `errorNames` table.
  - Use the new error-identification methods, such as `asMaybePasswordError`, to determine if an error is a specific type.
- Stop allowing `null` in places where we expect an `EdgeAccountOptions` object.
  - Just pass `undefined` if this parameter isn't used.
- Return the `EdgeAccount.otpResetDate` as a `Date` object.

The following changes affect Edge core plugins:

- Remove `EdgeIo.console` - Use `EdgeCorePluginOptions.log` instead.
- Define `EdgeCurrencyEngine` methods to return `Promise<void>` instead of `Promise<mixed>`.
- The core will no longer upgrade `pluginName` to `pluginId` for legacy currency plugins.

## 0.17.33 (2021-05-10)

- Add a `paused` flag to `EdgeCurrencyWallet`, and a matching `changePaused` method.
- Deprecate `EdgeCurrencyWallet.startEngine` - Use `EdgeCurrencyWallet.changePaused(false)` instead.
- Deprecate `EdgeCurrencyWallet.stopEngine` - Use `EdgeCurrencyWallet.changePaused(true)` instead.
- Clean legacy Airbitz wallet files to prevent potential crashes at login.

## 0.17.32 (2021-04-28)

- Enable safari10 option in webpack minimizer to fix stuck loading screens on iOS 10

## 0.17.31 (2021-04-22)

- Add `crash` and `breadcrumb` methods to `EdgeLog` for crash reporting.
- Deprecate the `options` prop on the `MakeEdgeContext` React Native component.
  - Just pass any context options as normal props.
- Reset the wallet sync ratio as part of a resync.

## 0.17.30 (2021-04-12)

- Deprecate several methods:
  - `EdgeContext.getRecovery2Key` - Use `EdgeUserInfo.recovery2Key` instead.
  - `EdgeCurrencyWallet.exportTransactionsToCSV` - Moved to edge-react-gui project.
  - `EdgeCurrencyWallet.exportTransactionsToQBO` - Moved to edge-react-gui project.
  - `EdgeCurrencyWallet.getDisplayPrivateSeed` - Use `EdgeCurrencyWallet.displayPrivateSeed` instead.
  - `EdgeCurrencyWallet.getDisplayPublicSeed` - Use `EdgeCurrencyWallet.displayPublicSeed` instead.
- Upgrade build scripts to use Webpack 5.

## 0.17.29 (2021-03-29)

- Fix an error which was causing all new 2FA-protected logins to fail.
- Add cleaners for all core error types, such as `asMaybeOtpError`. These provide a type-safe way to identify different error objects that may have been thrown.
- Deprecate the old `errorNames` table.

## 0.17.28 (2021-03-25)

- Fix a code-packaging error in the previous release.

## 0.17.27 (2021-03-25)

- Improve the `EdgePendingEdgeLogin` API.
  - Add a `state` field to track the progress of the barcode login.
  - Add other fields to hold the outcome of the barcode login.
  - Add a `watch` method to track changes to these fields.
- Allow `EdgeCurrencyEngine.dumpData` to return a promise.
- Cache exchange-rate hints from all local accounts to speed up initial rates query.
- Validate incoming & outgoing network requests even more thoroughly.

## 0.17.26 (2021-02-28)

- Fix the `EdgeContext.listRecoveryQuestionChoices` method.
  - Fix the runtime data validation to accept the actual server return values.
  - The return type of `Promise<string[]>` has always been incorrect, so the correct return type is now `Promise<EdgeRecoveryQuestionChoice[]>`.
  - As a stop-gap measure, though the return-type definitions is now `any`. We will insert the correct return type definition in the next breaking release.

## 0.17.25 (2021-02-27)

- Load all supported currency pairs at launch to improve exchange rate loading. List is replaced by enabled wallets once the wallets are loaded.

## 0.17.24 (2021-02-19)

- Fix the `parentNetworkFee` field missing in certain `EdgeTransaction` instances.
- Fix missing transactions while searching.
- Perform more data validation on network requests.
- Fix a bug that would prevent login vouchers from working on Airbitz accounts with 2fa turned on.
- Expose periodic 2fa errors through the context's `error` event.
- Add an `EdgeAccount.repairOtp` method.

## 0.17.23 (2021-02-10)

- Ensure all crypto to crypto exchange rates have a route to USD
- Add currency code column to CSV exports

## 0.17.22 (2021-01-26)

- Update `EdgeCurrencyEngine` to allow `getFreshAddres`, `addGapLimitAddresses`, and `isAddressUsed` to return promises.

## 0.17.21 (2021-01-25)

- Periodically perform a re-login to sync logged-in account credentials with the server.
- Fix a bug that would prevent the `EdgeContext.logSettings` property from updating.

## 0.17.20 (2021-01-21)

- Add an `EdgeContextOptions.logSettings` property to control logging verbosity, along with an `EdgeContext.changeLogSettings` method.
- Deprecate the `EdgeEncodeUri.legacyAddress` and `EdgeEncodeUri.segwitAddress` parameters. Just pass the address in `EdgeEncodeUri.publicAddress`, regardless of format.
- Update the swap logging to give more information about failed quotes.

## 0.17.19 (2020-12-31)

- Upgrade Airbitz accounts with secret-key login
- Filter duplicates from rateHints
- Add low priority edgeRates bias
- Update linting

## 0.17.18 (2020-11-27)

- (feature) Add ability to filter `getTransactions()` with `searchString` option
- (feature) Add requested currency pair to rateHints if it cannot be served by searchRoutes()

## 0.17.17 (2020-11-15)

- (feature) Identify enabled currency and fiat pairs to pass to exchange rate plugins

## 0.17.16 (2020-11-11)

- (feature) RBF Transaction Support
  - Adds new `rbfTxid` optional string to `EdgeSpendInfo` type definition
  - Adds new `rbfTxid` to the returned `EdgeTransaction` object in `makeSpend` on `EdgeCurrencyWallet` objects
- Include sync keys in the logs

## 0.17.15 (2020-10-08)

- (feature) Add onAddressChanged callback
  - This allows a plugin to inform the GUI of address or account name updates (e.g. when an EOS account becomes activated)

## 0.17.14 (2020-09-18)

- (fix) Don't crash when using a barcode to log into accounts with pending OTP resets.
- (fix) Correctly expire any vouchers on the device while doing a barcode login.
- (fix) Upgrade to node-fetch v2.6.1.

## 0.17.13 (2020-09-10)

- (fix) Switch to the new voucher endpoint.
- (fix) Always return `OtpError.voucherId` when available.
- (feature) Expose an `EdgeAccount.pendingVouchers` field.
- (feature) Expose as `EdgeUserInfo.voucherId` field.

## 0.17.12 (2020-08-31)

- (feature) Add a `keyLoginEnabled` flag to `EdgeUserInfo`.
- (feature) Add a `lastLogin` date to `EdgeUserInfo` and `EdgeAccount`.

## 0.17.11 (2020-08-21)

- (feature) Add a login voucher system. When a new device tries to log into an account with 2-factor security, the server can issue a voucher along with the `OtpError`. Existing devices with the 2-factor token can then log in and either approve or deny the voucher using `EdgeAccount.approveVoucher` or `EdgeAccount.rejectVoucher`. The `EdgeLoginMessages` type also includes a list of pending vouchers now.
- (chore) Upgrade to hash.js v1.1.7 and redux-keto v0.3.4.

## 0.17.10 (2020-08-17)

- (feature) Allow users to pass 6-digit OTP codes directly. This means `EdgeAccountOptions.otp` is deprecated for passing the secret. Use `EdgeAccountOptions.otpKey` to pass the secret, or `EdgeAccountOptions.otp` to pass the 6-digit code.
- (feature) Save usernames for first-time logins that fail 2fa.
- (feature) Save & return the account creation date as `EdgeAccount.created`.
- (fix) Harden server response parsing.
- (fix) Upgrade many dev dependencies.

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
