#include <jni.h>
#include <alloca.h>
#include "edge-sql.h"
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

/* --- SQL (see edge-sql.h) ---------------------------------------------- */

/*
 * These are thin: every decision lives in `edge-sql.c`, which iOS compiles
 * too, so the two platforms cannot drift on codec setup or value mapping.
 * A native failure becomes a Java exception, which `EdgeNative` turns into a
 * rejected promise like any other call.
 */

static void throwSqlError(JNIEnv *env, char *error) {
  jclass class = (*env)->FindClass(env, "java/lang/RuntimeException");
  (*env)->ThrowNew(env, class, error == NULL ? "SQL failed" : error);
  edgeSqlFree(error);
}

JNIEXPORT jint JNICALL
Java_app_edge_reactnative_core_EdgeNative_sqlOpen(
    JNIEnv *env,
    jobject self,
    jstring path,
    jbyteArray key
) {
  const char *pPath = (*env)->GetStringUTFChars(env, path, NULL);
  jsize keyLength = (*env)->GetArrayLength(env, key);
  jbyte *pKey = (*env)->GetByteArrayElements(env, key, NULL);

  char *error = NULL;
  int handle = edgeSqlOpen(pPath, (const unsigned char *)pKey, keyLength, &error);

  (*env)->ReleaseByteArrayElements(env, key, pKey, JNI_ABORT);
  (*env)->ReleaseStringUTFChars(env, path, pPath);

  if (handle < 0) throwSqlError(env, error);
  return handle;
}

/* Shared by sqlExec and sqlBatch, which differ only in the transaction. */
static jstring runStatementsJni(
    JNIEnv *env,
    jint handle,
    jstring statements,
    int transactional
) {
  const char *pStatements = (*env)->GetStringUTFChars(env, statements, NULL);
  char *error = NULL;
  char *result = transactional
                     ? edgeSqlBatch(handle, pStatements, &error)
                     : edgeSqlExec(handle, pStatements, &error);
  (*env)->ReleaseStringUTFChars(env, statements, pStatements);

  if (result == NULL) {
    throwSqlError(env, error);
    return NULL;
  }
  jstring out = (*env)->NewStringUTF(env, result);
  edgeSqlFree(result);
  return out;
}

JNIEXPORT jstring JNICALL
Java_app_edge_reactnative_core_EdgeNative_sqlExec(
    JNIEnv *env,
    jobject self,
    jint handle,
    jstring statements
) {
  return runStatementsJni(env, handle, statements, 0);
}

JNIEXPORT jstring JNICALL
Java_app_edge_reactnative_core_EdgeNative_sqlBatch(
    JNIEnv *env,
    jobject self,
    jint handle,
    jstring statements
) {
  return runStatementsJni(env, handle, statements, 1);
}

JNIEXPORT jstring JNICALL
Java_app_edge_reactnative_core_EdgeNative_sqlQuery(
    JNIEnv *env,
    jobject self,
    jint handle,
    jstring sql,
    jstring params
) {
  const char *pSql = (*env)->GetStringUTFChars(env, sql, NULL);
  const char *pParams =
      params == NULL ? NULL : (*env)->GetStringUTFChars(env, params, NULL);

  char *error = NULL;
  char *result = edgeSqlQuery(handle, pSql, pParams, &error);

  if (pParams != NULL) (*env)->ReleaseStringUTFChars(env, params, pParams);
  (*env)->ReleaseStringUTFChars(env, sql, pSql);

  if (result == NULL) {
    throwSqlError(env, error);
    return NULL;
  }
  jstring out = (*env)->NewStringUTF(env, result);
  edgeSqlFree(result);
  return out;
}

JNIEXPORT void JNICALL
Java_app_edge_reactnative_core_EdgeNative_sqlClose(
    JNIEnv *env,
    jobject self,
    jint handle
) {
  edgeSqlClose(handle);
}

JNIEXPORT void JNICALL
Java_app_edge_reactnative_core_EdgeNative_sqlDelete(
    JNIEnv *env,
    jobject self,
    jstring path
) {
  const char *pPath = (*env)->GetStringUTFChars(env, path, NULL);
  char *error = NULL;
  int status = edgeSqlDelete(pPath, &error);
  (*env)->ReleaseStringUTFChars(env, path, pPath);
  if (status != 0) throwSqlError(env, error);
}
