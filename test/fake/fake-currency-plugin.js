// @flow

import { add, lt } from 'biggystring'

import {
  type EdgeCorePluginOptions,
  type EdgeCreatePrivateKeyOptions,
  type EdgeCurrencyCodeOptions,
  type EdgeCurrencyEngine,
  type EdgeCurrencyEngineCallbacks,
  type EdgeCurrencyEngineOptions,
  type EdgeCurrencyInfo,
  type EdgeCurrencyPlugin,
  type EdgeDataDump,
  type EdgeFreshAddress,
  type EdgeGetTransactionsOptions,
  type EdgeParsedUri,
  type EdgeSpendInfo,
  type EdgeTokenInfo,
  type EdgeTransaction,
  type EdgeUnusedOptions,
  type EdgeWalletInfo,
  InsufficientFundsError
} from '../../src/index.js'

export const fakeCurrencyInfo: EdgeCurrencyInfo = {
  // Basic currency information:
  currencyCode: 'FAKE',
  currencyName: 'Fake Coin',
  pluginName: 'fakecoin',
  denominations: [
    { multiplier: '10', name: 'SMALL' },
    { multiplier: '100', name: 'FAKE' }
  ],
  walletTypes: ['wallet:fakecoin'],

  // Configuration options:
  defaultSettings: {},
  metaTokens: [
    {
      currencyCode: 'TOKEN',
      currencyName: 'Fake Token',
      denominations: [{ multiplier: '1000', name: 'TOKEN' }]
    }
  ],

  // Explorers:
  addressExplorer: 'https://edge.app',
  transactionExplorer: 'https://edge.app'
}

const nop: Function = () => {}

/**
 * Currency plugin transaction engine.
 */
class FakeCurrencyEngine {
  callbacks: EdgeCurrencyEngineCallbacks
  state: {
    balance: number,
    tokenBalance: number,
    blockHeight: number,
    progress: number,
    txs: { [txid: string]: EdgeTransaction }
  }

  constructor (walletInfo: EdgeWalletInfo, opts: EdgeCurrencyEngineOptions) {
    this.callbacks = opts.callbacks
    this.state = {
      balance: 0,
      tokenBalance: 0,
      blockHeight: 0,
      progress: 0,
      txs: {}
    }
    this._update(this.state)
  }

  _update (settings: Object = {}): mixed {
    const state = this.state
    const {
      onAddressesChecked = nop,
      onBalanceChanged = nop,
      onBlockHeightChanged = nop,
      onTransactionsChanged = nop
    } = this.callbacks

    // Address callback:
    if (settings.progress != null) {
      state.progress = settings.progress
      onAddressesChecked(state.progress)
    }

    // Balance callback:
    if (settings.balance != null) {
      state.balance = settings.balance
      onBalanceChanged('FAKE', state.balance.toString())
    }

    // Token balance callback:
    if (settings.tokenBalance != null) {
      state.tokenBalance = settings.tokenBalance
      onBalanceChanged('TOKEN', state.tokenBalance.toString())
    }

    // Block height callback:
    if (settings.blockHeight != null) {
      state.blockHeight = settings.blockHeight
      onBlockHeightChanged(state.blockHeight)
    }

    // Transactions callback:
    if (settings.txs != null) {
      const changes: Array<EdgeTransaction> = []
      for (const txid in settings.txs) {
        const newTx = {
          blockHeight: 0,
          date: 0,
          nativeAmount: '0',
          networkFee: '0',
          ourReceiveAddresses: [],
          ...settings.txs[txid],
          txid
        }
        const oldTx = state.txs[txid]

        let changed = false
        if (oldTx != null) {
          for (const item in newTx) {
            if (oldTx[item] !== newTx[item]) changed = true
          }
        } else {
          changed = true
        }
        if (changed) {
          changes.push(newTx)
          state.txs[txid] = newTx
        }
      }

      if (changes.length) onTransactionsChanged(changes)
    }
  }

  // Keys:
  getDisplayPrivateSeed (): string | null {
    return 'xpriv'
  }
  getDisplayPublicSeed (): string | null {
    return 'xpub'
  }

  // Engine state
  startEngine (): Promise<mixed> {
    return Promise.resolve()
  }
  killEngine (): Promise<mixed> {
    return Promise.resolve()
  }
  resyncBlockchain (): Promise<mixed> {
    return Promise.resolve()
  }
  dumpData (): EdgeDataDump {
    return {
      walletId: 'xxx',
      walletType: fakeCurrencyInfo.walletTypes[0],
      pluginType: 'currency',
      data: {}
    }
  }

  // Chain state
  getBlockHeight (): number {
    return this.state.blockHeight
  }
  getBalance (opts: EdgeCurrencyCodeOptions): string {
    const { currencyCode = 'FAKE' } = opts
    switch (currencyCode) {
      case 'FAKE':
        return this.state.balance.toString()
      case 'TOKEN':
        return this.state.tokenBalance.toString()
      default:
        throw new Error('Unknown currency')
    }
  }
  getNumTransactions (opts: EdgeCurrencyCodeOptions): number {
    return Object.keys(this.state.txs).length
  }
  getTransactions (
    opts: EdgeGetTransactionsOptions
  ): Promise<Array<EdgeTransaction>> {
    return Promise.resolve(
      Object.keys(this.state.txs).map(txid => this.state.txs[txid])
    )
  }

  // Tokens
  enableTokens (tokens: Array<string>): Promise<mixed> {
    return Promise.resolve()
  }
  disableTokens (tokens: Array<string>): Promise<mixed> {
    return Promise.resolve()
  }
  getEnabledTokens (): Promise<Array<string>> {
    return Promise.resolve(['TOKEN'])
  }
  addCustomToken (token: EdgeTokenInfo): Promise<mixed> {
    return Promise.resolve()
  }
  getTokenStatus (token: string): boolean {
    return token === 'TOKEN'
  }

  // Addresses:
  getFreshAddress (opts: EdgeCurrencyCodeOptions): EdgeFreshAddress {
    return { publicAddress: 'fakeaddress' }
  }
  addGapLimitAddresses (
    addresses: Array<string>,
    opts: EdgeUnusedOptions
  ): void {}
  isAddressUsed (address: string, opts: EdgeUnusedOptions): boolean {
    return address === 'fakeaddress'
  }

  // Spending:
  makeSpend (spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
    const { currencyCode = 'FAKE', spendTargets } = spendInfo

    // Check the spend targets:
    let total = '0'
    for (const spendTarget of spendTargets) {
      if (spendTarget.nativeAmount != null) {
        total = add(total, spendTarget.nativeAmount)
      }
    }

    // Check the balances:
    if (lt(this.getBalance({ currencyCode }), total)) {
      return Promise.reject(new InsufficientFundsError())
    }

    // TODO: Return a high-fidelity transaction
    return Promise.resolve({
      blockHeight: 0,
      currencyCode,
      date: 0,
      nativeAmount: total,
      networkFee: '0',
      otherParams: {},
      ourReceiveAddresses: [],
      signedTx: '',
      txid: ''
    })
  }
  signTx (transaction: EdgeTransaction): Promise<EdgeTransaction> {
    return Promise.resolve(transaction)
  }
  broadcastTx (transaction: EdgeTransaction): Promise<EdgeTransaction> {
    return Promise.resolve(transaction)
  }
  saveTx (transaction: EdgeTransaction): Promise<mixed> {
    return Promise.resolve()
  }
}

/**
 * Currency plugin setup object.
 */
class FakeCurrencyPlugin {
  engines: Array<FakeCurrencyEngine>

  constructor () {
    this.engines = []
  }

  // Information:
  get pluginName (): string {
    return fakeCurrencyInfo.pluginName
  }
  get currencyInfo (): EdgeCurrencyInfo {
    return fakeCurrencyInfo
  }
  async changeSettings (settings: Object): Promise<mixed> {
    for (const engine of this.engines) engine._update(settings)
  }

  // Keys:
  createPrivateKey (
    walletType: string,
    opts?: EdgeCreatePrivateKeyOptions
  ): Promise<Object> {
    if (walletType !== this.currencyInfo.walletTypes[0]) {
      throw new Error('Unsupported key type')
    }
    return Promise.resolve({ fakeKey: 'FakePrivateKey' })
  }
  derivePublicKey (walletInfo: EdgeWalletInfo): Promise<Object> {
    return Promise.resolve({})
  }
  getSplittableTypes (walletInfo: EdgeWalletInfo): Array<string> {
    return ['wallet:tulipcoin']
  }

  // URI parsing:
  parseUri (uri: string): EdgeParsedUri {
    return {}
  }
  encodeUri (): string {
    return ''
  }

  // Engine:
  makeEngine (
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions
  ): Promise<EdgeCurrencyEngine> {
    const out = new FakeCurrencyEngine(walletInfo, opts)
    this.engines.push(out)
    return Promise.resolve(out)
  }
}

export function makeFakeCurrencyPlugin (
  opts: EdgeCorePluginOptions
): EdgeCurrencyPlugin {
  return new FakeCurrencyPlugin()
}
