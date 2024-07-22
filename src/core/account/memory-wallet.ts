import { makeMemoryDisklet } from 'disklet'
import { bridgifyObject, close, update, watchMethod } from 'yaob'

import {
  EdgeBalanceMap,
  EdgeCreateCurrencyWalletOptions,
  EdgeCurrencyConfig,
  EdgeMemoryWallet,
  EdgeSpendInfo,
  EdgeTokenId,
  EdgeTransaction,
  EdgeWalletInfo
} from '../../browser'
import { makePeriodicTask, PeriodicTask } from '../../util/periodic-task'
import { snooze } from '../../util/snooze'
import { getMaxSpendableInner } from '../currency/wallet/max-spend'
import { makeLog } from '../log/log'
import { getCurrencyTools } from '../plugins/plugins-selectors'
import { ApiInput } from '../root-pixie'

let memoryWalletCount = 0

export const makeMemoryWalletInner = async (
  ai: ApiInput,
  config: EdgeCurrencyConfig,
  walletType: string,
  opts: EdgeCreateCurrencyWalletOptions = {}
): Promise<EdgeMemoryWallet> => {
  const { keys } = opts
  if (keys == null) throw new Error('No keys provided')

  const walletId = `memorywallet-${memoryWalletCount++}`
  const walletInfo: EdgeWalletInfo = {
    id: walletId,
    type: walletType,
    keys
  }

  const tools = await getCurrencyTools(ai, config.currencyInfo.pluginId)
  const publicKeys = await tools.derivePublicKey(walletInfo)
  walletInfo.keys = { ...publicKeys, ...walletInfo.keys }

  const log = makeLog(ai.props.logBackend, `${walletId}-${walletType}`)
  let balanceMap: EdgeBalanceMap = new Map()
  let detectedTokenIds: string[] = []
  let syncRatio: number = 0

  let needsUpdate = false
  const updateWallet = (): void => {
    if (needsUpdate) {
      update(out)
      needsUpdate = false
    }
  }
  const updater = makePeriodicTask(async () => {
    await snooze(1000) // one second
    updateWallet()
  }, 0)

  const plugin = ai.props.state.plugins.currency[config.currencyInfo.pluginId]
  const engine = await plugin.makeCurrencyEngine(walletInfo, {
    callbacks: {
      onAddressChanged: () => {},
      onAddressesChecked: (progressRatio: number) => {
        if (out.syncRatio === 1) return

        if (progressRatio === 1) {
          syncRatio = progressRatio
          needsUpdate = true
        }
      },
      onNewTokens: (tokenIds: string[]) => {
        const sortedTokenIds = tokenIds.sort((a, b) => a.localeCompare(b))

        if (detectedTokenIds.length !== sortedTokenIds.length) {
          detectedTokenIds = sortedTokenIds
          needsUpdate = true
          return
        }
        for (let i = 0; i < sortedTokenIds.length; i++) {
          if (detectedTokenIds[i] !== sortedTokenIds[i]) {
            detectedTokenIds = sortedTokenIds
            needsUpdate = true
            return
          }
        }
      },
      onStakingStatusChanged: () => {},
      onTokenBalanceChanged: (tokenId: EdgeTokenId, balance: string) => {
        if (balanceMap.get(tokenId) === balance) return

        balanceMap = new Map(balanceMap)
        balanceMap.set(tokenId, balance)
        needsUpdate = true
      },
      onTransactionsChanged: () => {},
      onTxidsChanged: () => {},
      onUnactivatedTokenIdsChanged: () => {},
      onWcNewContractCall: () => {},
      onBlockHeightChanged: () => {},
      onBalanceChanged: () => {}
    },
    customTokens: { ...config.customTokens },
    enabledTokenIds: [...Object.keys(config.allTokens)],
    lightMode: true,
    log,
    userSettings: { ...(config.userSettings ?? {}) },
    walletLocalDisklet: makeMemoryDisklet(),
    walletLocalEncryptedDisklet: makeMemoryDisklet()
  })

  const {
    unsafeBroadcastTx = false,
    unsafeMakeSpend = false,
    unsafeSyncNetwork = false
  } = plugin.currencyInfo

  const privateKeys = { ...keys }

  let syncNetworkTask: PeriodicTask
  // Setup syncNetwork routine if defined by the currency engine:
  if (engine.syncNetwork != null) {
    // Get the private keys if required by the engine:
    const doNetworkSync = async (): Promise<void> => {
      if (engine.syncNetwork != null) {
        const delay = await engine.syncNetwork({
          privateKeys: unsafeSyncNetwork ? { privateKeys: keys } : undefined
        })
        syncNetworkTask.setDelay(delay)
      } else {
        syncNetworkTask.stop()
      }
    }
    syncNetworkTask = makePeriodicTask(doNetworkSync, 10000, {
      onError: error => {
        ai.props.log.error(error)
      }
    })
    syncNetworkTask.start({ wait: false })
  }

  const out = bridgifyObject<EdgeMemoryWallet>({
    watch: watchMethod,
    get balanceMap() {
      return balanceMap
    },
    get detectedTokenIds() {
      return detectedTokenIds
    },
    get syncRatio() {
      return syncRatio
    },
    async changeEnabledTokenIds(tokenIds: string[]) {
      if (engine.changeEnabledTokenIds != null) {
        await engine.changeEnabledTokenIds(tokenIds)
      }
    },
    async startEngine() {
      await engine.startEngine()
      syncNetworkTask?.start({ wait: false })
    },
    async getMaxSpendable(spendInfo: EdgeSpendInfo) {
      return await getMaxSpendableInner(
        spendInfo,
        plugin,
        engine,
        config.allTokens,
        walletInfo
      )
    },
    async makeSpend(spendInfo: EdgeSpendInfo) {
      return await engine.makeSpend(
        spendInfo,
        unsafeMakeSpend ? privateKeys : undefined
      )
    },
    async signTx(tx: EdgeTransaction) {
      return await engine.signTx(tx, privateKeys)
    },
    async broadcastTx(tx: EdgeTransaction) {
      return await engine.broadcastTx(
        tx,
        unsafeBroadcastTx ? privateKeys : undefined
      )
    },
    async saveTx() {},

    async close() {
      log.warn('killing memory wallet')
      syncNetworkTask?.stop()
      close(out)
      await engine.killEngine()
    }
  })

  updater.start({ wait: false })
  return out
}
