import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

export interface Spec extends TurboModule {
  // Disklet operations
  diskletDelete(path: string): Promise<void>
  diskletGetData(path: string): Promise<string>
  diskletGetText(path: string): Promise<string>
  diskletList(path: string): Promise<Object>
  diskletSetData(path: string, base64Data: string): Promise<void>
  diskletSetText(path: string, text: string): Promise<void>
  
  // Network operations
  fetch(
    uri: string,
    method: string,
    headers: Object,
    body?: string,
    bodyIsBase64?: boolean
  ): Promise<Object>
  
  // Crypto operations
  randomBytes(size: number): Promise<string>
  scrypt(
    data: string,
    salt: string,
    n: number,
    r: number,
    p: number,
    dklen: number
  ): Promise<string>
}

export default TurboModuleRegistry.getEnforcing<Spec>('EdgeCore')