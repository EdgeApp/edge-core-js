import { asCodec, asObject, asOptional, asString, Cleaner } from 'cleaners'
import { justFolders, navigateDisklet } from 'disklet'

import { fixUsername } from '../../client-side'
import { asBase32, asEdgeBox, asEdgeSnrp } from '../../types/server-cleaners'
import { EdgeIo } from '../../types/types'
import { base58, utf8 } from '../../util/encoding'
import { makeJsonFile } from '../../util/file-helpers'
import { userIdSnrp } from '../scrypt/scrypt-selectors'
import { LoginStash } from './login-stash'

/**
 * Reads legacy Airbitz login stashes from disk.
 */
export async function loadAirbitzStashes(
  io: EdgeIo,
  avoidUsernames: Set<string>
): Promise<LoginStash[]> {
  const out: LoginStash[] = []

  const paths = await io.disklet.list('Accounts').then(justFolders)
  for (const path of paths) {
    const folder = navigateDisklet(io.disklet, path)
    const [
      carePackage,
      loginPackage,
      otp,
      pin2Key,
      recovery2Key,
      usernameJson
    ] = await Promise.all([
      await carePackageFile.load(folder, 'CarePackage.json'),
      await loginPackageFile.load(folder, 'LoginPackage.json'),
      await otpFile.load(folder, 'OtpKey.json'),
      await pin2KeyFile.load(folder, 'Pin2Key.json'),
      await recovery2KeyFile.load(folder, 'Recovery2Key.json'),
      await usernameFile.load(folder, 'UserName.json')
    ])

    if (usernameJson == null) continue
    const username = fixUsername(usernameJson.userName)
    if (avoidUsernames.has(username)) continue
    const userId = await io.scrypt(
      utf8.parse(username),
      userIdSnrp.salt_hex,
      userIdSnrp.n,
      userIdSnrp.r,
      userIdSnrp.p,
      32
    )

    // Assemble a modern stash object:
    const stash: LoginStash = {
      appId: '',
      loginId: userId,
      pendingVouchers: [],
      username
    }
    if (carePackage != null && loginPackage != null) {
      stash.passwordKeySnrp = carePackage.SNRP2
      stash.passwordBox = loginPackage.EMK_LP2
      stash.syncKeyBox = loginPackage.ESyncKey
      stash.passwordAuthBox = loginPackage.ELP1
    }
    if (otp != null) {
      stash.otpKey = otp.TOTP
    }
    if (pin2Key != null) {
      stash.pin2Key = pin2Key.pin2Key
    }
    if (recovery2Key != null) {
      stash.recovery2Key = recovery2Key.recovery2Key
    }

    out.push(stash)
  }

  return out
}

/**
 * A string of base58-encoded binary data.
 */
const asBase58: Cleaner<Uint8Array> = asCodec(
  raw => base58.parse(asString(raw)),
  clean => base58.stringify(clean)
)

const carePackageFile = makeJsonFile(
  asObject({
    SNRP2: asEdgeSnrp, // passwordKeySnrp
    SNRP3: asOptional(asEdgeSnrp), // recoveryKeySnrp
    SNRP4: asOptional(asEdgeSnrp), // questionKeySnrp
    ERQ: asOptional(asEdgeBox) // questionBox
  })
)

const loginPackageFile = makeJsonFile(
  asObject({
    EMK_LP2: asEdgeBox, // passwordBox
    EMK_LRA3: asOptional(asEdgeBox), // recoveryBox

    ESyncKey: asEdgeBox, // syncKeyBox
    ELP1: asEdgeBox // passwordAuthBox
  })
)

const otpFile = makeJsonFile(asObject({ TOTP: asBase32 }))
const pin2KeyFile = makeJsonFile(asObject({ pin2Key: asBase58 }))
const recovery2KeyFile = makeJsonFile(asObject({ recovery2Key: asBase58 }))
const usernameFile = makeJsonFile(asObject({ userName: asString }))
