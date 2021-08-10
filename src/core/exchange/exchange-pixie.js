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
    async function gatherHints(): Promise<EdgeRateHint[]> {
      const {
        rateHintCache,
        currency: { wallets }
      } = input.props.state

      for (const walletId of Object.keys(wallets)) {
        const fiat = wallets[walletId].fiat
        for (const cc of Object.keys(wallets[walletId].balances)) {
          if (isNewPair(cc, fiat, savedRateHints))
            savedRateHints.push({ fromCurrency: cc, toCurrency: fiat })
        }
      }

      // No hints in memory or in cache, return defaults
      if (savedRateHints.length === 0 && rateHintCache.length === 0) {
        return DEFAULT_RATE_HINTS
      }

      // No hints in memory and wallets haven't loaded, return hints on disk
      if (savedRateHints.length === 0 && rateHintCache.length > 0) {
        return rateHintCache
      }

      // Else, use hints in memory and add to disk cache if they're new
      try {
        const newHints = savedRateHints.filter(hint =>
          isNewPair(hint.fromCurrency, hint.toCurrency, rateHintCache)
        )
        if (newHints.length > 0) {
          await input.props.io.disklet.setText(
            'rateHintCache.json',
            JSON.stringify(rateHintCache.concat(newHints))
          )
          input.props.dispatch({
            type: 'UPDATE_RATE_HINT_CACHE',
            payload: {
              rateHintCache: rateHintCache.concat(newHints)
            }
          })
          input.props.log('Update rateHintCache.json success')
        }
      } catch (error) {
        input.props.log.error('Update rateHintCache.json error', error)
        input.props.onError(new Error('Failed to write rateHintCache'))
      }
      return savedRateHints
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

      const hintPairs = await gatherHints()

      // Gather pairs for up to five seconds, then send what we have:
      let wait: boolean = true
      let waitingPairs: ExchangePair[] = []
      function sendWaitingPairs(done: boolean = false): void {
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
          task.start({ wait: false })
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

export const DEFAULT_RATE_HINTS = [
  { fromCurrency: 'BTC', toCurrency: 'iso:AED' },
  { fromCurrency: 'BTC', toCurrency: 'iso:AFN' },
  { fromCurrency: 'BTC', toCurrency: 'iso:ALL' },
  { fromCurrency: 'BTC', toCurrency: 'iso:AMD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:ANG' },
  { fromCurrency: 'BTC', toCurrency: 'iso:AOA' },
  { fromCurrency: 'BTC', toCurrency: 'iso:ARS' },
  { fromCurrency: 'BTC', toCurrency: 'iso:AUD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:AWG' },
  { fromCurrency: 'BTC', toCurrency: 'iso:AZN' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BAM' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BBD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BDT' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BGN' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BIF' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BMD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BND' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BOB' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BRL' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BSD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BTN' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BWP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BYN' },
  { fromCurrency: 'BTC', toCurrency: 'iso:BZD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:CAD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:CDF' },
  { fromCurrency: 'BTC', toCurrency: 'iso:CHF' },
  { fromCurrency: 'BTC', toCurrency: 'iso:CLP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:CNY' },
  { fromCurrency: 'BTC', toCurrency: 'iso:COP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:CRC' },
  { fromCurrency: 'BTC', toCurrency: 'iso:CUC' },
  { fromCurrency: 'BTC', toCurrency: 'iso:CUP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:CVE' },
  { fromCurrency: 'BTC', toCurrency: 'iso:CZK' },
  { fromCurrency: 'BTC', toCurrency: 'iso:DJF' },
  { fromCurrency: 'BTC', toCurrency: 'iso:DKK' },
  { fromCurrency: 'BTC', toCurrency: 'iso:DOP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:DZD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:EGP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:ERN' },
  { fromCurrency: 'BTC', toCurrency: 'iso:ETB' },
  { fromCurrency: 'BTC', toCurrency: 'iso:EUR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:FJD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:FKP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:GBP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:GEL' },
  { fromCurrency: 'BTC', toCurrency: 'iso:GGP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:GHS' },
  { fromCurrency: 'BTC', toCurrency: 'iso:GIP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:GMD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:GNF' },
  { fromCurrency: 'BTC', toCurrency: 'iso:GTQ' },
  { fromCurrency: 'BTC', toCurrency: 'iso:GYD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:HKD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:HNL' },
  { fromCurrency: 'BTC', toCurrency: 'iso:HRK' },
  { fromCurrency: 'BTC', toCurrency: 'iso:HTG' },
  { fromCurrency: 'BTC', toCurrency: 'iso:HUF' },
  { fromCurrency: 'BTC', toCurrency: 'iso:IDR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:ILS' },
  { fromCurrency: 'BTC', toCurrency: 'iso:IMP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:INR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:IQD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:IRR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:ISK' },
  { fromCurrency: 'BTC', toCurrency: 'iso:JEP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:JMD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:JOD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:JPY' },
  { fromCurrency: 'BTC', toCurrency: 'iso:KES' },
  { fromCurrency: 'BTC', toCurrency: 'iso:KGS' },
  { fromCurrency: 'BTC', toCurrency: 'iso:KHR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:KMF' },
  { fromCurrency: 'BTC', toCurrency: 'iso:KPW' },
  { fromCurrency: 'BTC', toCurrency: 'iso:KRW' },
  { fromCurrency: 'BTC', toCurrency: 'iso:KWD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:KYD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:KZT' },
  { fromCurrency: 'BTC', toCurrency: 'iso:LAK' },
  { fromCurrency: 'BTC', toCurrency: 'iso:LBP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:LKR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:LRD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:LSL' },
  { fromCurrency: 'BTC', toCurrency: 'iso:LYD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MAD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MDL' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MGA' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MKD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MMK' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MNT' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MOP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MRO' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MRU' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MUR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MWK' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MXN' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MYR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:MZN' },
  { fromCurrency: 'BTC', toCurrency: 'iso:NAD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:NGN' },
  { fromCurrency: 'BTC', toCurrency: 'iso:NIO' },
  { fromCurrency: 'BTC', toCurrency: 'iso:NOK' },
  { fromCurrency: 'BTC', toCurrency: 'iso:NPR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:NZD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:OMR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:PAB' },
  { fromCurrency: 'BTC', toCurrency: 'iso:PEN' },
  { fromCurrency: 'BTC', toCurrency: 'iso:PGK' },
  { fromCurrency: 'BTC', toCurrency: 'iso:PHP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:PKR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:PLN' },
  { fromCurrency: 'BTC', toCurrency: 'iso:PRB' },
  { fromCurrency: 'BTC', toCurrency: 'iso:PYG' },
  { fromCurrency: 'BTC', toCurrency: 'iso:QAR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:RON' },
  { fromCurrency: 'BTC', toCurrency: 'iso:RSD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:RUB' },
  { fromCurrency: 'BTC', toCurrency: 'iso:RWF' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SAR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SBD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SCR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SDG' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SEK' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SGD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SHP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SLL' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SOS' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SRD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SSP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:STD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SYP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:SZL' },
  { fromCurrency: 'BTC', toCurrency: 'iso:THB' },
  { fromCurrency: 'BTC', toCurrency: 'iso:TJS' },
  { fromCurrency: 'BTC', toCurrency: 'iso:TMT' },
  { fromCurrency: 'BTC', toCurrency: 'iso:TND' },
  { fromCurrency: 'BTC', toCurrency: 'iso:TOP' },
  { fromCurrency: 'BTC', toCurrency: 'iso:TRY' },
  { fromCurrency: 'BTC', toCurrency: 'iso:TTD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:TVD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:TWD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:TZS' },
  { fromCurrency: 'BTC', toCurrency: 'iso:UAH' },
  { fromCurrency: 'BTC', toCurrency: 'iso:UGX' },
  { fromCurrency: 'BTC', toCurrency: 'iso:USD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:UYU' },
  { fromCurrency: 'BTC', toCurrency: 'iso:UZS' },
  { fromCurrency: 'BTC', toCurrency: 'iso:VEF' },
  { fromCurrency: 'BTC', toCurrency: 'iso:VND' },
  { fromCurrency: 'BTC', toCurrency: 'iso:VUV' },
  { fromCurrency: 'BTC', toCurrency: 'iso:WST' },
  { fromCurrency: 'BTC', toCurrency: 'iso:XAF' },
  { fromCurrency: 'BTC', toCurrency: 'iso:XCD' },
  { fromCurrency: 'BTC', toCurrency: 'iso:XOF' },
  { fromCurrency: 'BTC', toCurrency: 'iso:XPF' },
  { fromCurrency: 'BTC', toCurrency: 'iso:YER' },
  { fromCurrency: 'BTC', toCurrency: 'iso:ZAR' },
  { fromCurrency: 'BTC', toCurrency: 'iso:ZMW' },
  { fromCurrency: 'BCH', toCurrency: 'iso:AED' },
  { fromCurrency: 'BCH', toCurrency: 'iso:AFN' },
  { fromCurrency: 'BCH', toCurrency: 'iso:ALL' },
  { fromCurrency: 'BCH', toCurrency: 'iso:AMD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:ANG' },
  { fromCurrency: 'BCH', toCurrency: 'iso:AOA' },
  { fromCurrency: 'BCH', toCurrency: 'iso:ARS' },
  { fromCurrency: 'BCH', toCurrency: 'iso:AUD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:AWG' },
  { fromCurrency: 'BCH', toCurrency: 'iso:AZN' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BAM' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BBD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BDT' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BGN' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BIF' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BMD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BND' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BOB' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BRL' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BSD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BTN' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BWP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BYN' },
  { fromCurrency: 'BCH', toCurrency: 'iso:BZD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:CAD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:CDF' },
  { fromCurrency: 'BCH', toCurrency: 'iso:CHF' },
  { fromCurrency: 'BCH', toCurrency: 'iso:CLP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:CNY' },
  { fromCurrency: 'BCH', toCurrency: 'iso:COP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:CRC' },
  { fromCurrency: 'BCH', toCurrency: 'iso:CUC' },
  { fromCurrency: 'BCH', toCurrency: 'iso:CUP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:CVE' },
  { fromCurrency: 'BCH', toCurrency: 'iso:CZK' },
  { fromCurrency: 'BCH', toCurrency: 'iso:DJF' },
  { fromCurrency: 'BCH', toCurrency: 'iso:DKK' },
  { fromCurrency: 'BCH', toCurrency: 'iso:DOP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:DZD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:EGP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:ERN' },
  { fromCurrency: 'BCH', toCurrency: 'iso:ETB' },
  { fromCurrency: 'BCH', toCurrency: 'iso:EUR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:FJD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:FKP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:GBP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:GEL' },
  { fromCurrency: 'BCH', toCurrency: 'iso:GGP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:GHS' },
  { fromCurrency: 'BCH', toCurrency: 'iso:GIP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:GMD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:GNF' },
  { fromCurrency: 'BCH', toCurrency: 'iso:GTQ' },
  { fromCurrency: 'BCH', toCurrency: 'iso:GYD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:HKD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:HNL' },
  { fromCurrency: 'BCH', toCurrency: 'iso:HRK' },
  { fromCurrency: 'BCH', toCurrency: 'iso:HTG' },
  { fromCurrency: 'BCH', toCurrency: 'iso:HUF' },
  { fromCurrency: 'BCH', toCurrency: 'iso:IDR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:ILS' },
  { fromCurrency: 'BCH', toCurrency: 'iso:IMP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:INR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:IQD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:IRR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:ISK' },
  { fromCurrency: 'BCH', toCurrency: 'iso:JEP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:JMD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:JOD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:JPY' },
  { fromCurrency: 'BCH', toCurrency: 'iso:KES' },
  { fromCurrency: 'BCH', toCurrency: 'iso:KGS' },
  { fromCurrency: 'BCH', toCurrency: 'iso:KHR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:KMF' },
  { fromCurrency: 'BCH', toCurrency: 'iso:KPW' },
  { fromCurrency: 'BCH', toCurrency: 'iso:KRW' },
  { fromCurrency: 'BCH', toCurrency: 'iso:KWD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:KYD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:KZT' },
  { fromCurrency: 'BCH', toCurrency: 'iso:LAK' },
  { fromCurrency: 'BCH', toCurrency: 'iso:LBP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:LKR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:LRD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:LSL' },
  { fromCurrency: 'BCH', toCurrency: 'iso:LYD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MAD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MDL' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MGA' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MKD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MMK' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MNT' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MOP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MRO' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MRU' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MUR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MWK' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MXN' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MYR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:MZN' },
  { fromCurrency: 'BCH', toCurrency: 'iso:NAD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:NGN' },
  { fromCurrency: 'BCH', toCurrency: 'iso:NIO' },
  { fromCurrency: 'BCH', toCurrency: 'iso:NOK' },
  { fromCurrency: 'BCH', toCurrency: 'iso:NPR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:NZD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:OMR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:PAB' },
  { fromCurrency: 'BCH', toCurrency: 'iso:PEN' },
  { fromCurrency: 'BCH', toCurrency: 'iso:PGK' },
  { fromCurrency: 'BCH', toCurrency: 'iso:PHP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:PKR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:PLN' },
  { fromCurrency: 'BCH', toCurrency: 'iso:PRB' },
  { fromCurrency: 'BCH', toCurrency: 'iso:PYG' },
  { fromCurrency: 'BCH', toCurrency: 'iso:QAR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:RON' },
  { fromCurrency: 'BCH', toCurrency: 'iso:RSD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:RUB' },
  { fromCurrency: 'BCH', toCurrency: 'iso:RWF' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SAR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SBD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SCR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SDG' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SEK' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SGD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SHP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SLL' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SOS' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SRD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SSP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:STD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SYP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:SZL' },
  { fromCurrency: 'BCH', toCurrency: 'iso:THB' },
  { fromCurrency: 'BCH', toCurrency: 'iso:TJS' },
  { fromCurrency: 'BCH', toCurrency: 'iso:TMT' },
  { fromCurrency: 'BCH', toCurrency: 'iso:TND' },
  { fromCurrency: 'BCH', toCurrency: 'iso:TOP' },
  { fromCurrency: 'BCH', toCurrency: 'iso:TRY' },
  { fromCurrency: 'BCH', toCurrency: 'iso:TTD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:TVD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:TWD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:TZS' },
  { fromCurrency: 'BCH', toCurrency: 'iso:UAH' },
  { fromCurrency: 'BCH', toCurrency: 'iso:UGX' },
  { fromCurrency: 'BCH', toCurrency: 'iso:USD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:UYU' },
  { fromCurrency: 'BCH', toCurrency: 'iso:UZS' },
  { fromCurrency: 'BCH', toCurrency: 'iso:VEF' },
  { fromCurrency: 'BCH', toCurrency: 'iso:VND' },
  { fromCurrency: 'BCH', toCurrency: 'iso:VUV' },
  { fromCurrency: 'BCH', toCurrency: 'iso:WST' },
  { fromCurrency: 'BCH', toCurrency: 'iso:XAF' },
  { fromCurrency: 'BCH', toCurrency: 'iso:XCD' },
  { fromCurrency: 'BCH', toCurrency: 'iso:XOF' },
  { fromCurrency: 'BCH', toCurrency: 'iso:XPF' },
  { fromCurrency: 'BCH', toCurrency: 'iso:YER' },
  { fromCurrency: 'BCH', toCurrency: 'iso:ZAR' },
  { fromCurrency: 'BCH', toCurrency: 'iso:ZMW' },
  { fromCurrency: 'ETH', toCurrency: 'iso:AED' },
  { fromCurrency: 'ETH', toCurrency: 'iso:AFN' },
  { fromCurrency: 'ETH', toCurrency: 'iso:ALL' },
  { fromCurrency: 'ETH', toCurrency: 'iso:AMD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:ANG' },
  { fromCurrency: 'ETH', toCurrency: 'iso:AOA' },
  { fromCurrency: 'ETH', toCurrency: 'iso:ARS' },
  { fromCurrency: 'ETH', toCurrency: 'iso:AUD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:AWG' },
  { fromCurrency: 'ETH', toCurrency: 'iso:AZN' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BAM' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BBD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BDT' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BGN' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BIF' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BMD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BND' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BOB' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BRL' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BSD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BTN' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BWP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BYN' },
  { fromCurrency: 'ETH', toCurrency: 'iso:BZD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:CAD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:CDF' },
  { fromCurrency: 'ETH', toCurrency: 'iso:CHF' },
  { fromCurrency: 'ETH', toCurrency: 'iso:CLP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:CNY' },
  { fromCurrency: 'ETH', toCurrency: 'iso:COP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:CRC' },
  { fromCurrency: 'ETH', toCurrency: 'iso:CUC' },
  { fromCurrency: 'ETH', toCurrency: 'iso:CUP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:CVE' },
  { fromCurrency: 'ETH', toCurrency: 'iso:CZK' },
  { fromCurrency: 'ETH', toCurrency: 'iso:DJF' },
  { fromCurrency: 'ETH', toCurrency: 'iso:DKK' },
  { fromCurrency: 'ETH', toCurrency: 'iso:DOP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:DZD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:EGP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:ERN' },
  { fromCurrency: 'ETH', toCurrency: 'iso:ETB' },
  { fromCurrency: 'ETH', toCurrency: 'iso:EUR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:FJD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:FKP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:GBP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:GEL' },
  { fromCurrency: 'ETH', toCurrency: 'iso:GGP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:GHS' },
  { fromCurrency: 'ETH', toCurrency: 'iso:GIP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:GMD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:GNF' },
  { fromCurrency: 'ETH', toCurrency: 'iso:GTQ' },
  { fromCurrency: 'ETH', toCurrency: 'iso:GYD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:HKD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:HNL' },
  { fromCurrency: 'ETH', toCurrency: 'iso:HRK' },
  { fromCurrency: 'ETH', toCurrency: 'iso:HTG' },
  { fromCurrency: 'ETH', toCurrency: 'iso:HUF' },
  { fromCurrency: 'ETH', toCurrency: 'iso:IDR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:ILS' },
  { fromCurrency: 'ETH', toCurrency: 'iso:IMP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:INR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:IQD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:IRR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:ISK' },
  { fromCurrency: 'ETH', toCurrency: 'iso:JEP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:JMD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:JOD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:JPY' },
  { fromCurrency: 'ETH', toCurrency: 'iso:KES' },
  { fromCurrency: 'ETH', toCurrency: 'iso:KGS' },
  { fromCurrency: 'ETH', toCurrency: 'iso:KHR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:KMF' },
  { fromCurrency: 'ETH', toCurrency: 'iso:KPW' },
  { fromCurrency: 'ETH', toCurrency: 'iso:KRW' },
  { fromCurrency: 'ETH', toCurrency: 'iso:KWD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:KYD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:KZT' },
  { fromCurrency: 'ETH', toCurrency: 'iso:LAK' },
  { fromCurrency: 'ETH', toCurrency: 'iso:LBP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:LKR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:LRD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:LSL' },
  { fromCurrency: 'ETH', toCurrency: 'iso:LYD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MAD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MDL' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MGA' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MKD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MMK' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MNT' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MOP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MRO' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MRU' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MUR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MWK' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MXN' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MYR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:MZN' },
  { fromCurrency: 'ETH', toCurrency: 'iso:NAD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:NGN' },
  { fromCurrency: 'ETH', toCurrency: 'iso:NIO' },
  { fromCurrency: 'ETH', toCurrency: 'iso:NOK' },
  { fromCurrency: 'ETH', toCurrency: 'iso:NPR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:NZD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:OMR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:PAB' },
  { fromCurrency: 'ETH', toCurrency: 'iso:PEN' },
  { fromCurrency: 'ETH', toCurrency: 'iso:PGK' },
  { fromCurrency: 'ETH', toCurrency: 'iso:PHP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:PKR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:PLN' },
  { fromCurrency: 'ETH', toCurrency: 'iso:PRB' },
  { fromCurrency: 'ETH', toCurrency: 'iso:PYG' },
  { fromCurrency: 'ETH', toCurrency: 'iso:QAR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:RON' },
  { fromCurrency: 'ETH', toCurrency: 'iso:RSD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:RUB' },
  { fromCurrency: 'ETH', toCurrency: 'iso:RWF' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SAR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SBD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SCR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SDG' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SEK' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SGD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SHP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SLL' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SOS' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SRD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SSP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:STD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SYP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:SZL' },
  { fromCurrency: 'ETH', toCurrency: 'iso:THB' },
  { fromCurrency: 'ETH', toCurrency: 'iso:TJS' },
  { fromCurrency: 'ETH', toCurrency: 'iso:TMT' },
  { fromCurrency: 'ETH', toCurrency: 'iso:TND' },
  { fromCurrency: 'ETH', toCurrency: 'iso:TOP' },
  { fromCurrency: 'ETH', toCurrency: 'iso:TRY' },
  { fromCurrency: 'ETH', toCurrency: 'iso:TTD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:TVD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:TWD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:TZS' },
  { fromCurrency: 'ETH', toCurrency: 'iso:UAH' },
  { fromCurrency: 'ETH', toCurrency: 'iso:UGX' },
  { fromCurrency: 'ETH', toCurrency: 'iso:USD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:UYU' },
  { fromCurrency: 'ETH', toCurrency: 'iso:UZS' },
  { fromCurrency: 'ETH', toCurrency: 'iso:VEF' },
  { fromCurrency: 'ETH', toCurrency: 'iso:VND' },
  { fromCurrency: 'ETH', toCurrency: 'iso:VUV' },
  { fromCurrency: 'ETH', toCurrency: 'iso:WST' },
  { fromCurrency: 'ETH', toCurrency: 'iso:XAF' },
  { fromCurrency: 'ETH', toCurrency: 'iso:XCD' },
  { fromCurrency: 'ETH', toCurrency: 'iso:XOF' },
  { fromCurrency: 'ETH', toCurrency: 'iso:XPF' },
  { fromCurrency: 'ETH', toCurrency: 'iso:YER' },
  { fromCurrency: 'ETH', toCurrency: 'iso:ZAR' },
  { fromCurrency: 'ETH', toCurrency: 'iso:ZMW' }
]
