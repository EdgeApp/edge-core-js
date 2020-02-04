// @flow

import RequestUtils from '@requestnetwork/utils'

export function signRequestTransaction(
  ethereumKey: string,
  transaction: any
): string {
  // Normalize the transaction and hash it
  const hashData = RequestUtils.crypto.normalizeKeccak256Hash(transaction).value

  // sign the transaction
  return RequestUtils.crypto.EcUtils.sign(ethereumKey, hashData)
}
