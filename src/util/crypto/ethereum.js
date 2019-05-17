// @flow

import Transaction from 'ethereumjs-tx'
import { privateToAddress, toChecksumAddress } from 'ethereumjs-util'

import { type EthereumTransaction } from '../../types/types.js'

/**
 * This function needs to live inside the webpack bundle
 * to produce the right `Buffer` type.
 */
function hexToBuffer (hex: string) {
  return Buffer.from(hex.replace(/^0x/, ''), 'hex')
}

export function ethereumKeyToAddress (key: string): string {
  try {
    const addressBytes = privateToAddress(hexToBuffer(key))
    return toChecksumAddress(addressBytes.toString('hex'))
  } catch (e) {
    return 'invalid_private_key'
  }
}

export function signEthereumTransaction (
  ethereumKey: string,
  transaction: EthereumTransaction
): string {
  const tx = new Transaction(transaction)
  tx.sign(hexToBuffer(ethereumKey))
  return tx.serialize().toString('hex')
}
