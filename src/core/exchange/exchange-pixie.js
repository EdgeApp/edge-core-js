// @flow

import { type PixieInput, type TamePixie, filterPixie } from 'redux-pixies'

import { type EdgeRateHint, type EdgeRatePlugin } from '../../types/types.js'
import { makePeriodicTask } from '../../util/periodic-task.js'
import { type RootProps } from '../root-pixie.js'
import { type ExchangePair } from './exchange-reducer.js'

const savedRateHints: EdgeRateHint[] = []

export function addHint(fromCurrency: string, toCurrency: string) {
  if (isNewPair(fromCurrency, toCurrency, savedRateHints))
    savedRateHints.push({ fromCurrency, toCurrency })
}

export const exchange: TamePixie<RootProps> = filterPixie(
  (input: PixieInput<RootProps>) => {
    function gatherHints(): EdgeRateHint[] {
      const rateHints: EdgeRateHint[] = [...savedRateHints]
      const wallets = input.props.state.currency.wallets
      if (Object.keys(wallets).length === 0) return defaultRateHints
      for (const wallet in wallets) {
        const fiat = wallets[wallet].fiat
        for (const cc in wallets[wallet].balances) {
          if (isNewPair(cc, fiat, rateHints))
            rateHints.push({ fromCurrency: cc, toCurrency: fiat })
        }
      }
      return rateHints
    }

    function dispatchPairs(pairs: ExchangePair[], source: string): void {
      input.props.log.warn(`Exchange rates updated (${source})`)
      if (pairs.length > 0) {
        input.props.dispatch({
          type: 'EXCHANGE_PAIRS_FETCHED',
          payload: pairs
        })
      }
    }

    async function doFetch(): Promise<void> {
      // Quit early if there is nothing to do:
      const pluginIds = Object.keys(input.props.state.plugins.rate)
      if (pluginIds.length === 0) return

      const hintPairs = gatherHints()

      // Gather pairs for up to five seconds, then send what we have:
      let wait: boolean = true
      let waitingPairs: ExchangePair[] = []
      function sendWaitingPairs(done?: boolean): void {
        wait = false
        dispatchPairs(waitingPairs, done ? 'complete' : 'some pending')
      }
      const waitTimeout = setTimeout(sendWaitingPairs, 5000)

      // Initiate all requests:
      let finishedPairs: number = 0
      const timestamp = Date.now() / 1000
      const promises = pluginIds.map(pluginId => {
        const plugin = input.props.state.plugins.rate[pluginId]
        return fetchPluginRates(plugin, hintPairs, pluginId, timestamp)
          .then(pairs => {
            if (wait) waitingPairs = [...waitingPairs, ...pairs]
            else dispatchPairs(pairs, pluginId)
          })
          .catch(error => {
            input.props.log.error(
              `Rate provider ${pluginId} failed: ${String(error)}`
            )
          })
          .then(() => {
            // There is no need to keep waiting if all plugins are done:
            if (wait && ++finishedPairs >= pluginIds.length) {
              clearTimeout(waitTimeout)
              sendWaitingPairs(true)
            }
          })
      })

      // Wait for everyone to finish before doing another round:
      await Promise.all(promises)
    }

    // We don't report errors here, since the `doFetch` function does that:
    const task = makePeriodicTask(doFetch, 30 * 1000)

    return {
      update(props: RootProps): void {
        // Kick off the initial fetch if we don't already have one running
        // and the plugins are ready:
        if (props.state.plugins.locked) {
          task.start()
        }
      },

      destroy() {
        task.stop()
      }
    }
  },
  props => (props.state.paused ? undefined : props)
)

/**
 * Fetching exchange rates can fail in exciting ways,
 * so performs a fetch with maximum paranoia.
 */
function fetchPluginRates(
  plugin: EdgeRatePlugin,
  hintPairs: EdgeRateHint[],
  source: string,
  timestamp: number
): Promise<ExchangePair[]> {
  try {
    return plugin.fetchRates(hintPairs).then(pairs =>
      pairs.map(pair => {
        const { fromCurrency, toCurrency, rate } = pair
        if (
          typeof fromCurrency !== 'string' ||
          typeof toCurrency !== 'string' ||
          typeof rate !== 'number'
        ) {
          throw new TypeError('Invalid data format')
        }
        return {
          fromCurrency,
          toCurrency,
          rate,
          source,
          timestamp
        }
      })
    )
  } catch (error) {
    return Promise.reject(error)
  }
}

function isNewPair(
  fromCurrency: string,
  toCurrency: string,
  pairs: Object[]
): boolean {
  for (const pair of pairs) {
    if (pair.fromCurrency === fromCurrency && pair.toCurrency === toCurrency)
      return false
  }
  return true
}

const defaultRateHints = [
  { fromCurrency: 'BTC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:USD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:USD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:EUR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:USD' },
  { fromCurrency: 'BNB', toCurrency: 'iso:USD' },
  { fromCurrency: 'BNB', toCurrency: 'iso:EUR' },
  { fromCurrency: 'EOS', toCurrency: 'iso:USD' },
  { fromCurrency: 'EOS', toCurrency: 'iso:EUR' },
  { fromCurrency: 'TLOS', toCurrency: 'iso:USD' },
  { fromCurrency: 'TLOS', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ETC', toCurrency: 'iso:USD' },
  { fromCurrency: 'ETC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'RSK', toCurrency: 'iso:USD' },
  { fromCurrency: 'RSK', toCurrency: 'iso:EUR' },
  { fromCurrency: 'FIO', toCurrency: 'iso:USD' },
  { fromCurrency: 'FIO', toCurrency: 'iso:EUR' },
  { fromCurrency: 'XLM', toCurrency: 'iso:USD' },
  { fromCurrency: 'XLM', toCurrency: 'iso:EUR' },
  { fromCurrency: 'XTZ', toCurrency: 'iso:USD' },
  { fromCurrency: 'XTZ', toCurrency: 'iso:EUR' },
  { fromCurrency: 'XRP', toCurrency: 'iso:USD' },
  { fromCurrency: 'XRP', toCurrency: 'iso:EUR' },
  { fromCurrency: 'BTG', toCurrency: 'iso:USD' },
  { fromCurrency: 'BTG', toCurrency: 'iso:EUR' },
  { fromCurrency: 'BSV', toCurrency: 'iso:USD' },
  { fromCurrency: 'BSV', toCurrency: 'iso:EUR' },
  { fromCurrency: 'DASH', toCurrency: 'iso:USD' },
  { fromCurrency: 'DASH', toCurrency: 'iso:EUR' },
  { fromCurrency: 'DGB', toCurrency: 'iso:USD' },
  { fromCurrency: 'DGB', toCurrency: 'iso:EUR' },
  { fromCurrency: 'DOGE', toCurrency: 'iso:USD' },
  { fromCurrency: 'DOGE', toCurrency: 'iso:EUR' },
  { fromCurrency: 'EBST', toCurrency: 'iso:USD' },
  { fromCurrency: 'EBST', toCurrency: 'iso:EUR' },
  { fromCurrency: 'FTC', toCurrency: 'iso:USD' },
  { fromCurrency: 'FTC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'GRS', toCurrency: 'iso:USD' },
  { fromCurrency: 'GRS', toCurrency: 'iso:EUR' },
  { fromCurrency: 'LTC', toCurrency: 'iso:USD' },
  { fromCurrency: 'LTC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'QTUM', toCurrency: 'iso:USD' },
  { fromCurrency: 'QTUM', toCurrency: 'iso:EUR' },
  { fromCurrency: 'RVN', toCurrency: 'iso:USD' },
  { fromCurrency: 'RVN', toCurrency: 'iso:EUR' },
  { fromCurrency: 'SMART', toCurrency: 'iso:USD' },
  { fromCurrency: 'SMART', toCurrency: 'iso:EUR' },
  { fromCurrency: 'UFO', toCurrency: 'iso:USD' },
  { fromCurrency: 'UFO', toCurrency: 'iso:EUR' },
  { fromCurrency: 'VTC', toCurrency: 'iso:USD' },
  { fromCurrency: 'VTC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'FIRO', toCurrency: 'iso:USD' },
  { fromCurrency: 'FIRO', toCurrency: 'iso:EUR' },
  { fromCurrency: 'XMR', toCurrency: 'iso:USD' },
  { fromCurrency: 'XMR', toCurrency: 'iso:EUR' },
  { fromCurrency: 'REP', toCurrency: 'iso:USD' },
  { fromCurrency: 'REPV2', toCurrency: 'iso:USD' },
  { fromCurrency: 'HERC', toCurrency: 'iso:USD' },
  { fromCurrency: 'AGLD', toCurrency: 'iso:USD' },
  { fromCurrency: 'DAI', toCurrency: 'iso:USD' },
  { fromCurrency: 'SAI', toCurrency: 'iso:USD' },
  { fromCurrency: 'WINGS', toCurrency: 'iso:USD' },
  { fromCurrency: 'USDT', toCurrency: 'iso:USD' },
  { fromCurrency: 'IND', toCurrency: 'iso:USD' },
  { fromCurrency: 'HUR', toCurrency: 'iso:USD' },
  { fromCurrency: 'ANTV1', toCurrency: 'iso:USD' },
  { fromCurrency: 'ANT', toCurrency: 'iso:USD' },
  { fromCurrency: 'BAT', toCurrency: 'iso:USD' },
  { fromCurrency: 'BNT', toCurrency: 'iso:USD' },
  { fromCurrency: 'GNT', toCurrency: 'iso:USD' },
  { fromCurrency: 'KNC', toCurrency: 'iso:USD' },
  { fromCurrency: 'POLY', toCurrency: 'iso:USD' },
  { fromCurrency: 'STORJ', toCurrency: 'iso:USD' },
  { fromCurrency: 'USDC', toCurrency: 'iso:USD' },
  { fromCurrency: 'USDS', toCurrency: 'iso:USD' },
  { fromCurrency: 'TUSD', toCurrency: 'iso:USD' },
  { fromCurrency: 'ZRX', toCurrency: 'iso:USD' },
  { fromCurrency: 'GNO', toCurrency: 'iso:USD' },
  { fromCurrency: 'OMG', toCurrency: 'iso:USD' },
  { fromCurrency: 'NMR', toCurrency: 'iso:USD' },
  { fromCurrency: 'MKR', toCurrency: 'iso:USD' },
  { fromCurrency: 'GUSD', toCurrency: 'iso:USD' },
  { fromCurrency: 'PAX', toCurrency: 'iso:USD' },
  { fromCurrency: 'SALT', toCurrency: 'iso:USD' },
  { fromCurrency: 'MANA', toCurrency: 'iso:USD' },
  { fromCurrency: 'NEXO', toCurrency: 'iso:USD' },
  { fromCurrency: 'FUN', toCurrency: 'iso:USD' },
  { fromCurrency: 'KIN', toCurrency: 'iso:USD' },
  { fromCurrency: 'LINK', toCurrency: 'iso:USD' },
  { fromCurrency: 'BRZ', toCurrency: 'iso:USD' },
  { fromCurrency: 'CREP', toCurrency: 'iso:USD' },
  { fromCurrency: 'CUSDC', toCurrency: 'iso:USD' },
  { fromCurrency: 'CETH', toCurrency: 'iso:USD' },
  { fromCurrency: 'CBAT', toCurrency: 'iso:USD' },
  { fromCurrency: 'CZRX', toCurrency: 'iso:USD' },
  { fromCurrency: 'CWBTC', toCurrency: 'iso:USD' },
  { fromCurrency: 'CSAI', toCurrency: 'iso:USD' },
  { fromCurrency: 'CDAI', toCurrency: 'iso:USD' },
  { fromCurrency: 'ETHBNT', toCurrency: 'iso:USD' },
  { fromCurrency: 'OXT', toCurrency: 'iso:USD' },
  { fromCurrency: 'COMP', toCurrency: 'iso:USD' },
  { fromCurrency: 'MET', toCurrency: 'iso:USD' },
  { fromCurrency: 'SNX', toCurrency: 'iso:USD' },
  { fromCurrency: 'SUSD', toCurrency: 'iso:USD' },
  { fromCurrency: 'SBTC', toCurrency: 'iso:USD' },
  { fromCurrency: 'AAVE', toCurrency: 'iso:USD' },
  { fromCurrency: 'AYFI', toCurrency: 'iso:USD' },
  { fromCurrency: 'ALINK', toCurrency: 'iso:USD' },
  { fromCurrency: 'ADAI', toCurrency: 'iso:USD' },
  { fromCurrency: 'ABAT', toCurrency: 'iso:USD' },
  { fromCurrency: 'AWETH', toCurrency: 'iso:USD' },
  { fromCurrency: 'AWBTC', toCurrency: 'iso:USD' },
  { fromCurrency: 'ASNX', toCurrency: 'iso:USD' },
  { fromCurrency: 'AREN', toCurrency: 'iso:USD' },
  { fromCurrency: 'AUSDT', toCurrency: 'iso:USD' },
  { fromCurrency: 'AMKR', toCurrency: 'iso:USD' },
  { fromCurrency: 'AMANA', toCurrency: 'iso:USD' },
  { fromCurrency: 'AZRX', toCurrency: 'iso:USD' },
  { fromCurrency: 'AKNC', toCurrency: 'iso:USD' },
  { fromCurrency: 'AUSDC', toCurrency: 'iso:USD' },
  { fromCurrency: 'ASUSD', toCurrency: 'iso:USD' },
  { fromCurrency: 'AUNI', toCurrency: 'iso:USD' },
  { fromCurrency: 'WBTC', toCurrency: 'iso:USD' },
  { fromCurrency: 'YFI', toCurrency: 'iso:USD' },
  { fromCurrency: 'CRV', toCurrency: 'iso:USD' },
  { fromCurrency: 'BAL', toCurrency: 'iso:USD' },
  { fromCurrency: 'SUSHI', toCurrency: 'iso:USD' },
  { fromCurrency: 'UMA', toCurrency: 'iso:USD' },
  { fromCurrency: 'BADGER', toCurrency: 'iso:USD' },
  { fromCurrency: 'IDLE', toCurrency: 'iso:USD' },
  { fromCurrency: 'NXM', toCurrency: 'iso:USD' },
  { fromCurrency: 'CREAM', toCurrency: 'iso:USD' },
  { fromCurrency: 'PICKLE', toCurrency: 'iso:USD' },
  { fromCurrency: 'CVP', toCurrency: 'iso:USD' },
  { fromCurrency: 'ROOK', toCurrency: 'iso:USD' },
  { fromCurrency: 'DOUGH', toCurrency: 'iso:USD' },
  { fromCurrency: 'COMBO', toCurrency: 'iso:USD' },
  { fromCurrency: 'INDEX', toCurrency: 'iso:USD' },
  { fromCurrency: 'WETH', toCurrency: 'iso:USD' },
  { fromCurrency: 'RENBTC', toCurrency: 'iso:USD' },
  { fromCurrency: 'RENBCH', toCurrency: 'iso:USD' },
  { fromCurrency: 'RENZEC', toCurrency: 'iso:USD' },
  { fromCurrency: 'TBTC', toCurrency: 'iso:USD' },
  { fromCurrency: 'DPI', toCurrency: 'iso:USD' },
  { fromCurrency: 'YETI', toCurrency: 'iso:USD' },
  { fromCurrency: 'BAND', toCurrency: 'iso:USD' },
  { fromCurrency: 'REN', toCurrency: 'iso:USD' },
  { fromCurrency: 'AMPL', toCurrency: 'iso:USD' },
  { fromCurrency: 'OCEAN', toCurrency: 'iso:USD' },
  { fromCurrency: 'REP', toCurrency: 'iso:EUR' },
  { fromCurrency: 'REPV2', toCurrency: 'iso:EUR' },
  { fromCurrency: 'HERC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AGLD', toCurrency: 'iso:EUR' },
  { fromCurrency: 'DAI', toCurrency: 'iso:EUR' },
  { fromCurrency: 'SAI', toCurrency: 'iso:EUR' },
  { fromCurrency: 'WINGS', toCurrency: 'iso:EUR' },
  { fromCurrency: 'USDT', toCurrency: 'iso:EUR' },
  { fromCurrency: 'IND', toCurrency: 'iso:EUR' },
  { fromCurrency: 'HUR', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ANTV1', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ANT', toCurrency: 'iso:EUR' },
  { fromCurrency: 'BAT', toCurrency: 'iso:EUR' },
  { fromCurrency: 'BNT', toCurrency: 'iso:EUR' },
  { fromCurrency: 'GNT', toCurrency: 'iso:EUR' },
  { fromCurrency: 'KNC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'POLY', toCurrency: 'iso:EUR' },
  { fromCurrency: 'STORJ', toCurrency: 'iso:EUR' },
  { fromCurrency: 'USDC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'USDS', toCurrency: 'iso:EUR' },
  { fromCurrency: 'TUSD', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ZRX', toCurrency: 'iso:EUR' },
  { fromCurrency: 'GNO', toCurrency: 'iso:EUR' },
  { fromCurrency: 'OMG', toCurrency: 'iso:EUR' },
  { fromCurrency: 'NMR', toCurrency: 'iso:EUR' },
  { fromCurrency: 'MKR', toCurrency: 'iso:EUR' },
  { fromCurrency: 'GUSD', toCurrency: 'iso:EUR' },
  { fromCurrency: 'PAX', toCurrency: 'iso:EUR' },
  { fromCurrency: 'SALT', toCurrency: 'iso:EUR' },
  { fromCurrency: 'MANA', toCurrency: 'iso:EUR' },
  { fromCurrency: 'NEXO', toCurrency: 'iso:EUR' },
  { fromCurrency: 'FUN', toCurrency: 'iso:EUR' },
  { fromCurrency: 'KIN', toCurrency: 'iso:EUR' },
  { fromCurrency: 'LINK', toCurrency: 'iso:EUR' },
  { fromCurrency: 'BRZ', toCurrency: 'iso:EUR' },
  { fromCurrency: 'CREP', toCurrency: 'iso:EUR' },
  { fromCurrency: 'CUSDC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'CETH', toCurrency: 'iso:EUR' },
  { fromCurrency: 'CBAT', toCurrency: 'iso:EUR' },
  { fromCurrency: 'CZRX', toCurrency: 'iso:EUR' },
  { fromCurrency: 'CWBTC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'CSAI', toCurrency: 'iso:EUR' },
  { fromCurrency: 'CDAI', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ETHBNT', toCurrency: 'iso:EUR' },
  { fromCurrency: 'OXT', toCurrency: 'iso:EUR' },
  { fromCurrency: 'COMP', toCurrency: 'iso:EUR' },
  { fromCurrency: 'MET', toCurrency: 'iso:EUR' },
  { fromCurrency: 'SNX', toCurrency: 'iso:EUR' },
  { fromCurrency: 'SUSD', toCurrency: 'iso:EUR' },
  { fromCurrency: 'SBTC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AAVE', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AYFI', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ALINK', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ADAI', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ABAT', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AWETH', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AWBTC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ASNX', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AREN', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AUSDT', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AMKR', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AMANA', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AZRX', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AKNC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AUSDC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ASUSD', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AUNI', toCurrency: 'iso:EUR' },
  { fromCurrency: 'WBTC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'YFI', toCurrency: 'iso:EUR' },
  { fromCurrency: 'CRV', toCurrency: 'iso:EUR' },
  { fromCurrency: 'BAL', toCurrency: 'iso:EUR' },
  { fromCurrency: 'SUSHI', toCurrency: 'iso:EUR' },
  { fromCurrency: 'UMA', toCurrency: 'iso:EUR' },
  { fromCurrency: 'BADGER', toCurrency: 'iso:EUR' },
  { fromCurrency: 'IDLE', toCurrency: 'iso:EUR' },
  { fromCurrency: 'NXM', toCurrency: 'iso:EUR' },
  { fromCurrency: 'CREAM', toCurrency: 'iso:EUR' },
  { fromCurrency: 'PICKLE', toCurrency: 'iso:EUR' },
  { fromCurrency: 'CVP', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ROOK', toCurrency: 'iso:EUR' },
  { fromCurrency: 'DOUGH', toCurrency: 'iso:EUR' },
  { fromCurrency: 'COMBO', toCurrency: 'iso:EUR' },
  { fromCurrency: 'INDEX', toCurrency: 'iso:EUR' },
  { fromCurrency: 'WETH', toCurrency: 'iso:EUR' },
  { fromCurrency: 'RENBTC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'RENBCH', toCurrency: 'iso:EUR' },
  { fromCurrency: 'RENZEC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'TBTC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'DPI', toCurrency: 'iso:EUR' },
  { fromCurrency: 'YETI', toCurrency: 'iso:EUR' },
  { fromCurrency: 'BAND', toCurrency: 'iso:EUR' },
  { fromCurrency: 'REN', toCurrency: 'iso:EUR' },
  { fromCurrency: 'AMPL', toCurrency: 'iso:EUR' },
  { fromCurrency: 'OCEAN', toCurrency: 'iso:EUR' }
]
