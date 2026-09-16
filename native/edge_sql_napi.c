/*
 * Node bindings for the SQL shim.
 *
 * Design:
 * https://github.com/EdgeApp/edge-plans/blob/master/2026-09/edge-core-transaction-database.md
 *
 * This exists so Node runs the *same* `edge-sql.c` and the same SQLite
 * amalgamation as iOS and Android. The alternative -- a third-party binding --
 * would mean a second SQLite that can drift from the vendored one, and none of
 * the available ones expose `sqlite3_set_authorizer`, which the plugin fence
 * depends on. Running the fence on device but not in tests would be backwards.
 *
 * Every function is synchronous, matching the driver above it: the JS side
 * serializes work onto a promise chain so that Node and the native bridge
 * interleave the same way.
 */

#include <stdlib.h>
#include <string.h>

#include <node_api.h>

#include "edge-sql.h"

#define CHECK(call)                     \
  do {                                  \
    if ((call) != napi_ok) return NULL; \
  } while (0)

/** Throws `error` as a JS exception, taking ownership of it. */
static napi_value throwSqlError(napi_env env, char *error) {
  napi_throw_error(env, NULL, error == NULL ? "SQL failed" : error);
  edgeSqlFree(error);
  return NULL;
}

/** Reads a JS string argument into a fresh buffer the caller must free. */
static char *readString(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok) {
    return NULL;
  }
  char *out = malloc(length + 1);
  if (out == NULL) return NULL;
  if (napi_get_value_string_utf8(env, value, out, length + 1, &length) !=
      napi_ok) {
    free(out);
    return NULL;
  }
  return out;
}

/** Reads an argument that may be null or undefined, yielding NULL for those. */
static char *readOptionalString(napi_env env, napi_value value) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok) return NULL;
  if (type == napi_null || type == napi_undefined) return NULL;
  return readString(env, value);
}

static int readHandle(napi_env env, napi_value value) {
  int32_t handle = -1;
  napi_get_value_int32(env, value, &handle);
  return handle;
}

/** Returns a native string as a JS string, taking ownership of it. */
static napi_value takeString(napi_env env, char *text) {
  napi_value out;
  napi_status status = napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &out);
  edgeSqlFree(text);
  return status == napi_ok ? out : NULL;
}

static napi_value jsOpen(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  if (argc < 2) {
    napi_throw_type_error(env, NULL, "open(path, key) needs two arguments");
    return NULL;
  }

  char *path = readString(env, argv[0]);
  if (path == NULL) return NULL;

  void *key = NULL;
  size_t keyLength = 0;
  if (napi_get_buffer_info(env, argv[1], &key, &keyLength) != napi_ok) {
    free(path);
    napi_throw_type_error(env, NULL, "key must be a Buffer");
    return NULL;
  }

  char *error = NULL;
  int handle = edgeSqlOpen(path, key, (int)keyLength, &error);
  free(path);
  if (handle < 0) return throwSqlError(env, error);

  napi_value out;
  CHECK(napi_create_int32(env, handle, &out));
  return out;
}

/* `exec` and `batch` differ only in the transaction, so they share this. */
static napi_value runStatements(
    napi_env env,
    napi_callback_info info,
    int transactional
) {
  size_t argc = 2;
  napi_value argv[2];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));

  int handle = readHandle(env, argv[0]);
  char *statements = readString(env, argv[1]);
  if (statements == NULL) return NULL;

  char *error = NULL;
  char *result = transactional ? edgeSqlBatch(handle, statements, &error)
                               : edgeSqlExec(handle, statements, &error);
  free(statements);
  if (result == NULL) return throwSqlError(env, error);
  return takeString(env, result);
}

static napi_value jsExec(napi_env env, napi_callback_info info) {
  return runStatements(env, info, 0);
}

static napi_value jsBatch(napi_env env, napi_callback_info info) {
  return runStatements(env, info, 1);
}

static napi_value jsQuery(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));

  int handle = readHandle(env, argv[0]);
  char *sql = readString(env, argv[1]);
  if (sql == NULL) return NULL;
  char *params = argc > 2 ? readOptionalString(env, argv[2]) : NULL;

  char *error = NULL;
  char *result = edgeSqlQuery(handle, sql, params, &error);
  free(sql);
  free(params);
  if (result == NULL) return throwSqlError(env, error);
  return takeString(env, result);
}

static napi_value jsSetScope(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));

  int handle = readHandle(env, argv[0]);
  char *pluginId = argc > 1 ? readOptionalString(env, argv[1]) : NULL;
  char *prefix = argc > 2 ? readOptionalString(env, argv[2]) : NULL;
  char *walletId = argc > 3 ? readOptionalString(env, argv[3]) : NULL;

  char *error = NULL;
  int status = edgeSqlSetScope(handle, pluginId, prefix, walletId, &error);
  free(pluginId);
  free(prefix);
  free(walletId);
  if (status != 0) return throwSqlError(env, error);
  return NULL;
}

static napi_value jsClose(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));
  edgeSqlClose(readHandle(env, argv[0]));
  return NULL;
}

static napi_value jsDelete(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  CHECK(napi_get_cb_info(env, info, &argc, argv, NULL, NULL));

  char *path = readString(env, argv[0]);
  if (path == NULL) return NULL;

  char *error = NULL;
  int status = edgeSqlDelete(path, &error);
  free(path);
  if (status != 0) return throwSqlError(env, error);
  return NULL;
}

static napi_value init(napi_env env, napi_value exports) {
  const napi_property_descriptor properties[] = {
    { "open", NULL, jsOpen, NULL, NULL, NULL, napi_default, NULL },
    { "exec", NULL, jsExec, NULL, NULL, NULL, napi_default, NULL },
    { "batch", NULL, jsBatch, NULL, NULL, NULL, napi_default, NULL },
    { "query", NULL, jsQuery, NULL, NULL, NULL, napi_default, NULL },
    { "setScope", NULL, jsSetScope, NULL, NULL, NULL, napi_default, NULL },
    { "close", NULL, jsClose, NULL, NULL, NULL, napi_default, NULL },
    { "remove", NULL, jsDelete, NULL, NULL, NULL, napi_default, NULL }
  };
  napi_define_properties(
      env, exports, sizeof properties / sizeof properties[0], properties);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
