#include <jni.h>
#include <alloca.h>
#include "scrypt/crypto_scrypt.h"

JNIEXPORT jbyteArray JNICALL
Java_app_edge_reactnative_core_EdgeNative_scrypt(
    JNIEnv *env,
    jobject self,
    jbyteArray data,
    jbyteArray salt,
    jint n,
    jint r,
    jint p,
    jint dklen
) {
  jsize dataLength = (*env)->GetArrayLength(env, data);
  jsize saltLength = (*env)->GetArrayLength(env, salt);
  jbyte *pData = alloca(dataLength * sizeof(jbyte));
  jbyte *pSalt = alloca(saltLength * sizeof(jbyte));
  jbyte *pOut = alloca(dklen * sizeof(jbyte));
  jbyteArray out = (*env)->NewByteArray(env, dklen);
  if (!out) return NULL;

  (*env)->GetByteArrayRegion(env, data, 0, dataLength, pData);
  (*env)->GetByteArrayRegion(env, salt, 0, saltLength, pSalt);

  if (crypto_scrypt(
    pData, dataLength,
    pSalt, saltLength,
    n, r, p,
    pOut, dklen
  )) return NULL;

  (*env)->SetByteArrayRegion(env, out, 0, dklen, pOut);
  return out;
}
