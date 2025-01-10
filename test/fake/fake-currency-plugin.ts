import { add, lt } from 'biggystring'
import { asNumber, asObject, asOptional, asString } from 'cleaners'

import {
  EdgeCurrencyEngine,
  EdgeCurrencyEngineCallbacks,
  EdgeCurrencyEngineOptions,
  EdgeCurrencyInfo,
  EdgeCurrencyPlugin,
  EdgeCurrencyTools,
  EdgeDataDump,
  EdgeFreshAddress,
  EdgeGetReceiveAddressOptions,
  EdgeGetTransactionsOptions,
  EdgeParsedUri,
  EdgeSpendInfo,
  EdgeStakingStatus,
  EdgeToken,
  EdgeTokenIdOptions,
  EdgeTokenMap,
  EdgeTransaction,
  EdgeWalletInfo,
  InsufficientFundsError
} from '../../src/index'
import { upgradeCurrencyCode } from '../../src/types/type-helpers'
import { compare } from '../../src/util/compare'

const GENESIS_BLOCK = 1231006505000

const fakeTokens: EdgeTokenMap = {
  badf00d5: {
    currencyCode: 'TOKEN',
    denominations: [{ multiplier: '1000', name: 'TOKEN' }],
    displayName: 'Fake Token',
    networkLocation: {
      contractAddress: '0xBADF00D5'
    }
  }
}

const fakeCurrencyInfo: EdgeCurrencyInfo = {
  currencyCode: 'FAKE',
  displayName: 'Fake Coin',
  chainDisplayName: 'Fake Chain',
  assetDisplayName: 'Fake Coin',
  pluginId: 'fakecoin',
  walletType: 'wallet:fakecoin',

  // Explorers:
  addressExplorer: 'https://edge.app',
  transactionExplorer: 'https://edge.app',

  denominations: [
    { multiplier: '10', name: 'SMALL' },
    { multiplier: '100', name: 'FAKE' }
  ],

  // Deprecated:
  defaultSettings: {},
  metaTokens: [],
  memoType: 'text'
}

interface State {
  balance: number
  stakedBalance: number
  tokenBalance: number
  blockHeight: number
  progress: number
  txs: { [txid: string]: EdgeTransaction }
}

const asState = asObject({
  balance: asOptional(asNumber),
  stakedBalance: asOptional(asNumber),
  tokenBalance: asOptional(asNumber),
  blockHeight: asOptional(asNumber),
  progress: asOptional(asNumber),
  txs: asOptional(asObject((raw: any) => raw))
})

/**
 * Currency plugin transaction engine.
 */
class FakeCurrencyEngine implements EdgeCurrencyEngine {
  private readonly walletId: string
  private readonly callbacks: EdgeCurrencyEngineCallbacks
  private running: boolean
  private readonly state: State
  private allTokens: EdgeTokenMap = fakeTokens

  constructor(walletInfo: EdgeWalletInfo, opts: EdgeCurrencyEngineOptions) {
    this.walletId = walletInfo.id
    this.callbacks = opts.callbacks
    this.running = false
    this.state = {
      balance: 0,
      stakedBalance: 0,
      tokenBalance: 0,
      blockHeight: 0,
      progress: 0,
      txs: {}
    }
    // Fire initial callbacks:
    this.updateState(this.state)
  }

  private updateState(settings: Partial<State>): void {
    const state = this.state
    const {
      onAddressesChecked,
      onTokenBalanceChanged,
      onBlockHeightChanged,
      onStakingStatusChanged,
      onTransactionsChanged
    } = this.callbacks

    // Address callback:
    if (settings.progress != null) {
      state.progress = settings.progress
      onAddressesChecked(state.progress)
    }

    // Balance callback:
    if (settings.balance != null) {
      state.balance = settings.balance
      onTokenBalanceChanged(null, state.balance.toString())
    }

    // Staking status callback:
    if (settings.stakedBalance != null) {
      state.stakedBalance = settings.stakedBalance
      onStakingStatusChanged({
        stakedAmounts: [{ nativeAmount: String(state.stakedBalance) }]
      })
    }

    // Token balance callback:
    if (settings.tokenBalance != null) {
      state.tokenBalance = settings.tokenBalance
      onTokenBalanceChanged('badf00d5', state.tokenBalance.toString())
    }

    // Block height callback:
    if (settings.blockHeight != null) {
      state.blockHeight = settings.blockHeight
      onBlockHeightChanged(state.blockHeight)
    }

    // Transactions callback:
    if (settings.txs != null) {
      const changes: EdgeTransaction[] = []
      for (const txid of Object.keys(settings.txs)) {
        const incoming: Partial<EdgeTransaction> = settings.txs[txid]
        const { tokenId = null } = upgradeCurrencyCode({
          allTokens: this.allTokens,
          currencyCode: incoming.currencyCode,
          currencyInfo: fakeCurrencyInfo
        })
        const newTx: EdgeTransaction = {
          blockHeight: 0,
          currencyCode: 'FAKE',
          date: GENESIS_BLOCK,
          isSend: false,
          memos: [],
          nativeAmount: '0',
          networkFee: '0',
          networkFees: [],
          ourReceiveAddresses: [],
          signedTx: '',
          tokenId,
          ...incoming,
          txid,
          walletId: this.walletId
        }
        const oldTx = state.txs[txid]

        if (oldTx == null || !compare(oldTx, newTx)) {
          changes.push(newTx)
          state.txs[txid] = newTx
        }
      }

      if (changes.length > 0) onTransactionsChanged(changes)
    }
  }

  async changeUserSettings(settings: object): Promise<void> {
    await this.updateState(asState(settings))
  }

  // Engine state
  async startEngine(): Promise<void> {
    this.running = true
  }

  async killEngine(): Promise<void> {
    this.running = false
  }

  resyncBlockchain(): Promise<void> {
    return Promise.resolve()
  }

  async dumpData(): Promise<EdgeDataDump> {
    return {
      walletId: 'xxx',
      walletType: fakeCurrencyInfo.walletType,
      data: { fakeEngine: { running: this.running } }
    }
  }

  // Chain state
  getBlockHeight(): number {
    return this.state.blockHeight
  }

  getBalance(opts: EdgeTokenIdOptions): string {
    const { tokenId = null } = opts
    if (tokenId == null) return this.state.balance.toString()
    if (tokenId === 'badf00d5') this.state.tokenBalance.toString()
    if (this.allTokens[tokenId] != null) return '0'
    throw new Error('Unknown currency')
  }

  getNumTransactions(opts: EdgeTokenIdOptions): number {
    return Object.keys(this.state.txs).length
  }

  getTransactions(
    opts: EdgeGetTransactionsOptions
  ): Promise<EdgeTransaction[]> {
    return Promise.resolve(
      Object.keys(this.state.txs).map(txid => this.state.txs[txid])
    )
  }

  // Tokens:
  changeCustomTokens(tokens: EdgeTokenMap): Promise<void> {
    this.allTokens = { ...tokens, ...fakeTokens }
    return Promise.resolve()
  }

  changeEnabledTokenIds(tokenIds: string[]): Promise<void> {
    return Promise.resolve()
  }

  // Staking:
  async getStakingStatus(): Promise<EdgeStakingStatus> {
    return {
      stakedAmounts: [{ nativeAmount: String(this.state.stakedBalance) }]
    }
  }

  // Addresses:
  async getFreshAddress(
    opts: EdgeGetReceiveAddressOptions
  ): Promise<EdgeFreshAddress> {
    return {
      publicAddress: 'fakeaddress',
      nativeBalance: this.state.balance.toString(),
      segwitAddress: 'fakesegwit',
      legacyAddress: 'fakelegacy'
    }
  }

  async addGapLimitAddresses(addresses: string[]): Promise<void> {}

  async isAddressUsed(address: string): Promise<boolean> {
    return address === 'fakeaddress'
  }

  // Spending:
  makeSpend(spendInfo: EdgeSpendInfo): Promise<EdgeTransaction> {
    const { memos = [], spendTargets, tokenId = null } = spendInfo
    const { currencyCode } =
      tokenId == null ? fakeCurrencyInfo : this.allTokens[tokenId]

    // Check the spend targets:
    let total = '0'
    for (const spendTarget of spendTargets) {
      if (spendTarget.nativeAmount != null) {
        total = add(total, spendTarget.nativeAmount)
      }
    }

    // Check the balances:
    if (lt(this.getBalance({ tokenId }), total)) {
      return Promise.reject(new InsufficientFundsError({ tokenId }))
    }

    // TODO: Return a high-fidelity transaction
    return Promise.resolve({
      blockHeight: 0,
      currencyCode,
      date: GENESIS_BLOCK,
      feeRateUsed: { fakePrice: 0 },
      isSend: false,
      memos,
      nativeAmount: total,
      networkFee: '23',
      networkFees: [],
      otherParams: {},
      ourReceiveAddresses: [],
      signedTx: '',
      txid: 'spend',
      tokenId,
      walletId: this.walletId
    })
  }

  signTx(transaction: EdgeTransaction): Promise<EdgeTransaction> {
    transaction.txSecret = 'open sesame'
    return Promise.resolve(transaction)
  }

  broadcastTx(transaction: EdgeTransaction): Promise<EdgeTransaction> {
    return Promise.resolve(transaction)
  }

  saveTx(transaction: EdgeTransaction): Promise<void> {
    return Promise.resolve()
  }

  // Accelerating:
  async accelerate(
    transaction: EdgeTransaction
  ): Promise<EdgeTransaction | null> {
    return null
  }
}

/**
 * Currency plugin setup object.
 */
class FakeCurrencyTools implements EdgeCurrencyTools {
  // Keys:
  createPrivateKey(walletType: string, opts?: object): Promise<object> {
    if (walletType !== fakeCurrencyInfo.walletType) {
      throw new Error('Unsupported key type')
    }
    return Promise.resolve({ fakeKey: 'FakePrivateKey' })
  }

  async derivePublicKey(privateWalletInfo: EdgeWalletInfo): Promise<object> {
    return { fakeAddress: 'FakePublicAddress' }
  }

  async getTokenId(token: EdgeToken): Promise<string> {
    const { contractAddress } = asNetworkLocation(token.networkLocation)
    return contractAddress.toLowerCase().replace(/^0x/, '')
  }

  async getDisplayPrivateKey(
    privateWalletInfo: EdgeWalletInfo
  ): Promise<string> {
    return 'xpriv'
  }

  async getDisplayPublicKey(
    privateWalletInfo: EdgeWalletInfo
  ): Promise<string> {
    return 'xpub'
  }

  getSplittableTypes(publicWalletInfo: EdgeWalletInfo): string[] {
    return ['wallet:tulipcoin']
  }

  // URI parsing:
  parseUri(uri: string): Promise<EdgeParsedUri> {
    return Promise.resolve({})
  }

  encodeUri(): Promise<string> {
    return Promise.resolve('')
  }
}

export const fakeCurrencyPlugin: EdgeCurrencyPlugin = {
  currencyInfo: fakeCurrencyInfo,

  getBuiltinTokens(): Promise<EdgeTokenMap> {
    return Promise.resolve(fakeTokens)
  },

  makeCurrencyEngine(
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions
  ): Promise<EdgeCurrencyEngine> {
    return Promise.resolve(new FakeCurrencyEngine(walletInfo, opts))
  },

  makeCurrencyTools(): Promise<EdgeCurrencyTools> {
    return Promise.resolve(new FakeCurrencyTools())
  }
}

const asNetworkLocation = asObject({
  contractAddress: asString
})
