#include "edge-sql.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* CocoaPods flattens headers, so this is by name and the search path is set
 * in CMakeLists.txt for the Android build. */
#include "sqlite3mc_amalgamation.h"

/*
 * Open databases, addressed by handle. An account has one database, opened on
 * login and closed on logout, so this table is small -- but it grows rather
 * than being fixed, because a test fixture can hold many at once.
 */
static sqlite3 **gDatabases;
static int gCapacity;
static sqlite3_mutex *gMutex;

static void edgeSqlInit(void) {
  if (gMutex == NULL) gMutex = sqlite3_mutex_alloc(SQLITE_MUTEX_FAST);
}

static sqlite3 *lookup(int handle) {
  if (handle < 0 || handle >= gCapacity) return NULL;
  return gDatabases[handle];
}

/** Reserves a handle for `db`, growing the table if every slot is busy. */
static int takeHandle(sqlite3 *db) {
  for (int i = 0; i < gCapacity; ++i) {
    if (gDatabases[i] == NULL) {
      gDatabases[i] = db;
      return i;
    }
  }

  int capacity = gCapacity == 0 ? 8 : gCapacity * 2;
  sqlite3 **grown =
      sqlite3_realloc(gDatabases, capacity * (int)sizeof(*gDatabases));
  if (grown == NULL) return -1;
  gDatabases = grown;
  for (int i = gCapacity; i < capacity; ++i) gDatabases[i] = NULL;

  int handle = gCapacity;
  gCapacity = capacity;
  gDatabases[handle] = db;
  return handle;
}

static char *copyString(const char *text) {
  if (text == NULL) text = "";
  size_t size = strlen(text) + 1;
  char *out = sqlite3_malloc((int)size);
  if (out != NULL) memcpy(out, text, size);
  return out;
}

static void fail(char **error, const char *message) {
  if (error != NULL) *error = copyString(message);
}

static void failDb(char **error, sqlite3 *db) {
  fail(error, sqlite3_errmsg(db));
}

void edgeSqlFree(char *text) {
  sqlite3_free(text);
}

/* --- JSON output ------------------------------------------------------- */

/*
 * Appends `text` as a JSON string literal.
 *
 * SQLite's own printf has no JSON escape, so this does it: the two mandatory
 * escapes, plus every control character as \u00XX. UTF-8 above 0x1f passes
 * through untouched, which is correct -- JSON strings are Unicode.
 */
static void appendJsonString(sqlite3_str *out, const char *text) {
  sqlite3_str_appendchar(out, 1, '"');
  for (const unsigned char *p = (const unsigned char *)text; *p != 0; ++p) {
    switch (*p) {
      case '"': sqlite3_str_append(out, "\\\"", 2); break;
      case '\\': sqlite3_str_append(out, "\\\\", 2); break;
      case '\n': sqlite3_str_append(out, "\\n", 2); break;
      case '\r': sqlite3_str_append(out, "\\r", 2); break;
      case '\t': sqlite3_str_append(out, "\\t", 2); break;
      case '\b': sqlite3_str_append(out, "\\b", 2); break;
      case '\f': sqlite3_str_append(out, "\\f", 2); break;
      default:
        if (*p < 0x20) {
          sqlite3_str_appendf(out, "\\u%04x", *p);
        } else {
          sqlite3_str_appendchar(out, 1, (char)*p);
        }
    }
  }
  sqlite3_str_appendchar(out, 1, '"');
}

static const char kBase64[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/*
 * Appends a blob as a base64 JSON string.
 *
 * Blobs reach JavaScript only when a caller selects a raw document column,
 * since the core always wraps those in `json()`. Encoding rather than passing
 * the bytes through keeps a NUL from silently truncating the value.
 */
static void appendJsonBlob(
    sqlite3_str *out,
    const unsigned char *bytes,
    int length
) {
  sqlite3_str_appendchar(out, 1, '"');
  int i = 0;
  for (; i + 2 < length; i += 3) {
    unsigned int chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    sqlite3_str_appendchar(out, 1, kBase64[(chunk >> 18) & 0x3f]);
    sqlite3_str_appendchar(out, 1, kBase64[(chunk >> 12) & 0x3f]);
    sqlite3_str_appendchar(out, 1, kBase64[(chunk >> 6) & 0x3f]);
    sqlite3_str_appendchar(out, 1, kBase64[chunk & 0x3f]);
  }
  if (i < length) {
    int remaining = length - i;
    unsigned int chunk = bytes[i] << 16;
    if (remaining == 2) chunk |= bytes[i + 1] << 8;
    sqlite3_str_appendchar(out, 1, kBase64[(chunk >> 18) & 0x3f]);
    sqlite3_str_appendchar(out, 1, kBase64[(chunk >> 12) & 0x3f]);
    sqlite3_str_appendchar(out, 1,
                           remaining == 2 ? kBase64[(chunk >> 6) & 0x3f] : '=');
    sqlite3_str_appendchar(out, 1, '=');
  }
  sqlite3_str_appendchar(out, 1, '"');
}

static void appendColumn(
    sqlite3_str *out,
    sqlite3_stmt *statement,
    int column
) {
  switch (sqlite3_column_type(statement, column)) {
    case SQLITE_NULL:
      sqlite3_str_append(out, "null", 4);
      break;
    case SQLITE_INTEGER:
      sqlite3_str_appendf(out, "%lld", sqlite3_column_int64(statement, column));
      break;
    case SQLITE_FLOAT:
      /* 17 digits round-trips an IEEE double exactly. */
      sqlite3_str_appendf(out, "%!.17g",
                          sqlite3_column_double(statement, column));
      break;
    case SQLITE_BLOB:
      appendJsonBlob(out, sqlite3_column_blob(statement, column),
                     sqlite3_column_bytes(statement, column));
      break;
    default:
      appendJsonString(out,
                       (const char *)sqlite3_column_text(statement, column));
  }
}

/* --- Sortable amounts --------------------------------------------------- */

/*
 * `edge_native_amount_key(text)` -- a sort key for a signed 256-bit amount.
 *
 * Native amounts are exact integers up to 2^256, which no SQLite numeric type
 * holds: INTEGER is 64 bits, and REAL would round. They are therefore stored
 * as the decimal strings the plugins already produce, and TEXT compares
 * lexicographically -- "9" sorts after "10", and "-9" after "-10". Any query
 * that orders or ranges over an amount needs a key that sorts the way the
 * number does.
 *
 * The encoding is sign, then magnitude, then digits:
 *
 *   -10  ->  "M99789"    "M" + (999 - 2) + nine's complement of "10"
 *   -5   ->  "M9984"     "M" + (999 - 1) + nine's complement of "5"
 *    0   ->  "P000"
 *    5   ->  "P0015"
 *    10  ->  "P00210"
 *
 * "M" < "P", so every negative sorts below every non-negative. Within the
 * non-negatives the digit count leads, so a longer number is a larger one, and
 * equal-length numbers fall back to their digits. Negatives invert both parts
 * -- the count by subtracting it from 999, the digits by nine's complement --
 * so a larger magnitude sorts lower. Three digits of count carries any input
 * this can be handed; 2^256 is 78 digits.
 *
 * Returns NULL for anything that is not an integer, which sorts as NULL rather
 * than as a wrong number.
 *
 * Keys are written into ordinary columns by the index triggers rather than
 * produced by a generated column, so reading an amount-ordered table needs
 * nothing but SQLite. Only writing needs this function. What that costs is
 * that the encoding is on-disk format: changing it means reindexing every
 * table that stores a key.
 */
static void edgeNativeAmountKeyFunc(
    sqlite3_context *context,
    int argc,
    sqlite3_value **argv
) {
  (void)argc;
  if (sqlite3_value_type(argv[0]) == SQLITE_NULL) {
    sqlite3_result_null(context);
    return;
  }

  const char *text = (const char *)sqlite3_value_text(argv[0]);
  if (text == NULL) {
    sqlite3_result_null(context);
    return;
  }

  int negative = 0;
  const char *p = text;
  if (*p == '-') {
    negative = 1;
    ++p;
  } else if (*p == '+') {
    ++p;
  }
  const char *afterSign = p;

  /* Leading zeros carry no value, and would otherwise change the digit count
   * and so the sort order. "007" and "7" have to produce one key. */
  while (*p == '0') ++p;
  const char *digits = p;
  while (*p >= '0' && *p <= '9') ++p;
  const char *end = p;

  /* The whole string has to be digits, and there has to be at least one --
   * "12a", "" and a bare "-" are all not numbers. */
  if (*end != 0 || end == afterSign) {
    sqlite3_result_null(context);
    return;
  }

  int count = (int)(end - digits);
  if (count > 999) {
    sqlite3_result_null(context);
    return;
  }

  sqlite3_str *out = sqlite3_str_new(NULL);
  if (count == 0) {
    /* Zero, however it was spelled -- "0", "-0", "000". One key for all. */
    sqlite3_str_append(out, "P000", 4);
  } else if (negative) {
    sqlite3_str_appendf(out, "M%03d", 999 - count);
    for (const char *p = digits; p < end; ++p) {
      sqlite3_str_appendchar(out, 1, (char)('9' - (*p - '0')));
    }
  } else {
    sqlite3_str_appendf(out, "P%03d", count);
    sqlite3_str_append(out, digits, count);
  }

  char *key = sqlite3_str_finish(out);
  if (key == NULL) {
    sqlite3_result_error_nomem(context);
    return;
  }
  sqlite3_result_text(context, key, -1, sqlite3_free);
}

/* --- Parameter binding ------------------------------------------------- */

/*
 * Binds a JSON array of parameters.
 *
 * SQLite parses the JSON, rather than this file doing it: `json_each` already
 * reports each element's type, and using it means there is no hand-written
 * parser to disagree with the one the query layer uses.
 */
static int bindParams(
    sqlite3 *db,
    sqlite3_stmt *statement,
    const char *paramsJson,
    char **error
) {
  if (paramsJson == NULL || paramsJson[0] == 0) return SQLITE_OK;

  sqlite3_stmt *iterator = NULL;
  int status = sqlite3_prepare_v2(
      db, "SELECT type, value FROM json_each(?1)", -1, &iterator, NULL);
  if (status != SQLITE_OK) {
    failDb(error, db);
    return status;
  }
  sqlite3_bind_text(iterator, 1, paramsJson, -1, SQLITE_STATIC);

  int index = 1;
  while (sqlite3_step(iterator) == SQLITE_ROW) {
    const char *type = (const char *)sqlite3_column_text(iterator, 0);
    if (type == NULL || strcmp(type, "null") == 0) {
      sqlite3_bind_null(statement, index);
    } else if (strcmp(type, "integer") == 0) {
      sqlite3_bind_int64(statement, index, sqlite3_column_int64(iterator, 1));
    } else if (strcmp(type, "real") == 0) {
      sqlite3_bind_double(statement, index, sqlite3_column_double(iterator, 1));
    } else if (strcmp(type, "true") == 0) {
      sqlite3_bind_int(statement, index, 1);
    } else if (strcmp(type, "false") == 0) {
      sqlite3_bind_int(statement, index, 0);
    } else {
      sqlite3_bind_text(statement, index,
                        (const char *)sqlite3_column_text(iterator, 1), -1,
                        SQLITE_TRANSIENT);
    }
    ++index;
  }
  sqlite3_finalize(iterator);
  return SQLITE_OK;
}

/* --- Statement lists --------------------------------------------------- */

typedef struct {
  char *sql;
  char *params;
} EdgeStatement;

/*
 * Reads `[{ "sql": ..., "params": [...] }, ...]` into an array.
 *
 * The list is copied out and the iterator closed before anything runs, so no
 * read cursor is open on the connection while the batch writes to it.
 */
static int readStatements(
    sqlite3 *db,
    const char *statementsJson,
    EdgeStatement **out,
    int *count,
    char **error
) {
  *out = NULL;
  *count = 0;

  sqlite3_stmt *iterator = NULL;
  int status = sqlite3_prepare_v2(
      db,
      "SELECT json_extract(value, '$.sql'), json_extract(value, '$.params')"
      "  FROM json_each(?1)",
      -1, &iterator, NULL);
  if (status != SQLITE_OK) {
    failDb(error, db);
    return status;
  }
  sqlite3_bind_text(iterator, 1, statementsJson, -1, SQLITE_STATIC);

  int capacity = 8;
  EdgeStatement *list = sqlite3_malloc(capacity * (int)sizeof(EdgeStatement));
  if (list == NULL) {
    sqlite3_finalize(iterator);
    fail(error, "out of memory");
    return SQLITE_NOMEM;
  }

  while (sqlite3_step(iterator) == SQLITE_ROW) {
    if (*count == capacity) {
      capacity *= 2;
      EdgeStatement *grown =
          sqlite3_realloc(list, capacity * (int)sizeof(EdgeStatement));
      if (grown == NULL) {
        sqlite3_free(list);
        sqlite3_finalize(iterator);
        fail(error, "out of memory");
        return SQLITE_NOMEM;
      }
      list = grown;
    }
    list[*count].sql =
        copyString((const char *)sqlite3_column_text(iterator, 0));
    list[*count].params =
        sqlite3_column_type(iterator, 1) == SQLITE_NULL
            ? NULL
            : copyString((const char *)sqlite3_column_text(iterator, 1));
    ++*count;
  }
  sqlite3_finalize(iterator);

  *out = list;
  return SQLITE_OK;
}

static void freeStatements(EdgeStatement *list, int count) {
  if (list == NULL) return;
  for (int i = 0; i < count; ++i) {
    sqlite3_free(list[i].sql);
    sqlite3_free(list[i].params);
  }
  sqlite3_free(list);
}

/* Runs every statement, appending each one's change count to `out`. */
static int runStatements(
    sqlite3 *db,
    EdgeStatement *list,
    int count,
    sqlite3_str *out,
    char **error
) {
  for (int i = 0; i < count; ++i) {
    /*
     * One entry may hold several statements -- a schema block, for instance.
     * `sqlite3_prepare_v2` compiles only the first and reports the rest as a
     * tail, which it is on us to keep compiling; dropping it would execute
     * part of a caller's SQL and report success.
     *
     * Parameters bind to the first statement only, which is the shape the
     * driver above always sends: one statement, its own parameters.
     */
    const char *tail = list[i].sql;
    int first = 1;
    while (tail != NULL && *tail != 0) {
      sqlite3_stmt *statement = NULL;
      int status = sqlite3_prepare_v2(db, tail, -1, &statement, &tail);
      if (status != SQLITE_OK) {
        failDb(error, db);
        return status;
      }
      /* Whitespace or a trailing comment compiles to nothing. */
      if (statement == NULL) continue;

      if (first) {
        status = bindParams(db, statement, list[i].params, error);
        if (status != SQLITE_OK) {
          sqlite3_finalize(statement);
          return status;
        }
        first = 0;
      }
      while ((status = sqlite3_step(statement)) == SQLITE_ROW) {
        /* A statement may return rows; `exec` discards them. */
      }
      if (status != SQLITE_DONE) {
        failDb(error, db);
        sqlite3_finalize(statement);
        return status;
      }
      sqlite3_finalize(statement);
    }

    if (i > 0) sqlite3_str_appendchar(out, 1, ',');
    sqlite3_str_appendf(out, "%d", sqlite3_changes(db));
  }
  return SQLITE_OK;
}

/* --- Public interface -------------------------------------------------- */

int edgeSqlOpen(
    const char *path,
    const unsigned char *key,
    int keyLength,
    char **error
) {
  edgeSqlInit();

  sqlite3 *db = NULL;
  if (sqlite3_open(path, &db) != SQLITE_OK) {
    failDb(error, db);
    sqlite3_close(db);
    return -1;
  }

  char *message = NULL;
  if (keyLength == 0) {
    /*
     * No codec. This exists for in-memory databases, which the codec refuses
     * outright -- "Setting key not supported for in-memory or temporary
     * databases" -- because there is no file to encrypt, and which therefore
     * have nothing at rest to protect. Callers must never open a *file* this
     * way; the driver above enforces that.
     */
    if (sqlite3_exec(db, "PRAGMA foreign_keys = ON;", NULL, NULL, &message)) {
      fail(error, message);
      sqlite3_free(message);
      sqlite3_close(db);
      return -1;
    }
  } else {
    /*
     * Order is load-bearing. The codec has to be configured before any other
     * statement reaches the connection -- `journal_mode` is a statement, so
     * the WAL block below cannot move above this.
     *
     * `legacy = 4` is what makes the file byte-compatible with SQLCipher 4. It
     * is not a weaker setting: it carries SQLCipher 4's own parameters, and
     * differs only in on-disk framing.
     *
     * The key goes in as a raw blob literal, which skips PBKDF2. It already
     * has full entropy, and 256000 iterations of HMAC-SHA512 on every login
     * would buy nothing.
     */
    sqlite3_str *pragma = sqlite3_str_new(db);
    sqlite3_str_appendf(pragma, "PRAGMA cipher = 'sqlcipher';");
    sqlite3_str_appendf(pragma, "PRAGMA legacy = 4;");
    sqlite3_str_appendf(pragma, "PRAGMA key = \"x'");
    for (int i = 0; i < keyLength; ++i) {
      sqlite3_str_appendf(pragma, "%02x", key[i]);
    }
    sqlite3_str_appendf(pragma, "'\";");
    char *pragmaSql = sqlite3_str_finish(pragma);

    int status = sqlite3_exec(db, pragmaSql, NULL, NULL, &message);
    sqlite3_free(pragmaSql);
    if (status != SQLITE_OK) {
      fail(error, message == NULL ? "cannot apply the database key" : message);
      sqlite3_free(message);
      sqlite3_close(db);
      return -1;
    }

    /*
     * An unknown PRAGMA is silently ignored by SQLite, so a build without the
     * codec would hand back a plaintext database with no error anywhere.
     * Prove the codec is present rather than assume it.
     */
    sqlite3_stmt *check = NULL;
    int hasCodec = 0;
    if (sqlite3_prepare_v2(db, "PRAGMA cipher", -1, &check, NULL) ==
        SQLITE_OK) {
      if (sqlite3_step(check) == SQLITE_ROW) {
        const char *cipher = (const char *)sqlite3_column_text(check, 0);
        hasCodec = cipher != NULL && strcmp(cipher, "sqlcipher") == 0;
      }
      sqlite3_finalize(check);
    }
    if (!hasCodec) {
      fail(error, "this SQLite build has no SQLCipher codec");
      sqlite3_close(db);
      return -1;
    }

    status = sqlite3_exec(db,
                          "PRAGMA journal_mode = WAL;"
                          "PRAGMA synchronous = NORMAL;"
                          "PRAGMA busy_timeout = 5000;"
                          "PRAGMA foreign_keys = ON;",
                          NULL, NULL, &message);
    if (status != SQLITE_OK) {
      fail(error, message);
      sqlite3_free(message);
      sqlite3_close(db);
      return -1;
    }
  }

  sqlite3_create_function(db, "edge_native_amount_key", 1,
                          SQLITE_UTF8 | SQLITE_DETERMINISTIC, NULL,
                          edgeNativeAmountKeyFunc, NULL, NULL);

  sqlite3_mutex_enter(gMutex);
  int handle = takeHandle(db);
  sqlite3_mutex_leave(gMutex);

  if (handle < 0) {
    fail(error, "out of memory");
    sqlite3_close(db);
    return -1;
  }
  return handle;
}

static char *execInternal(
    int handle,
    const char *statementsJson,
    int transactional,
    char **error
) {
  sqlite3 *db = lookup(handle);
  if (db == NULL) {
    fail(error, "this database is closed");
    return NULL;
  }

  EdgeStatement *list = NULL;
  int count = 0;
  if (readStatements(db, statementsJson, &list, &count, error) != SQLITE_OK) {
    return NULL;
  }

  if (transactional && sqlite3_exec(db, "BEGIN IMMEDIATE", NULL, NULL, NULL)) {
    failDb(error, db);
    freeStatements(list, count);
    return NULL;
  }

  sqlite3_str *out = sqlite3_str_new(db);
  sqlite3_str_appendchar(out, 1, '[');
  int status = runStatements(db, list, count, out, error);
  freeStatements(list, count);

  if (status != SQLITE_OK) {
    if (transactional) sqlite3_exec(db, "ROLLBACK", NULL, NULL, NULL);
    sqlite3_free(sqlite3_str_finish(out));
    return NULL;
  }
  if (transactional && sqlite3_exec(db, "COMMIT", NULL, NULL, NULL)) {
    failDb(error, db);
    sqlite3_exec(db, "ROLLBACK", NULL, NULL, NULL);
    sqlite3_free(sqlite3_str_finish(out));
    return NULL;
  }

  sqlite3_str_appendchar(out, 1, ']');
  return sqlite3_str_finish(out);
}

char *edgeSqlExec(int handle, const char *statementsJson, char **error) {
  return execInternal(handle, statementsJson, 0, error);
}

char *edgeSqlBatch(int handle, const char *statementsJson, char **error) {
  return execInternal(handle, statementsJson, 1, error);
}

char *edgeSqlQuery(
    int handle,
    const char *sql,
    const char *paramsJson,
    char **error
) {
  sqlite3 *db = lookup(handle);
  if (db == NULL) {
    fail(error, "this database is closed");
    return NULL;
  }

  sqlite3_stmt *statement = NULL;
  if (sqlite3_prepare_v2(db, sql, -1, &statement, NULL) != SQLITE_OK) {
    failDb(error, db);
    return NULL;
  }
  if (bindParams(db, statement, paramsJson, error) != SQLITE_OK) {
    sqlite3_finalize(statement);
    return NULL;
  }

  int columns = sqlite3_column_count(statement);
  sqlite3_str *out = sqlite3_str_new(db);
  sqlite3_str_appendchar(out, 1, '[');

  int status;
  int row = 0;
  while ((status = sqlite3_step(statement)) == SQLITE_ROW) {
    if (row++ > 0) sqlite3_str_appendchar(out, 1, ',');
    sqlite3_str_appendchar(out, 1, '{');
    for (int i = 0; i < columns; ++i) {
      if (i > 0) sqlite3_str_appendchar(out, 1, ',');
      appendJsonString(out, sqlite3_column_name(statement, i));
      sqlite3_str_appendchar(out, 1, ':');
      appendColumn(out, statement, i);
    }
    sqlite3_str_appendchar(out, 1, '}');
  }
  sqlite3_finalize(statement);

  if (status != SQLITE_DONE) {
    failDb(error, db);
    sqlite3_free(sqlite3_str_finish(out));
    return NULL;
  }

  sqlite3_str_appendchar(out, 1, ']');
  return sqlite3_str_finish(out);
}

void edgeSqlClose(int handle) {
  edgeSqlInit();
  sqlite3_mutex_enter(gMutex);
  sqlite3 *db = lookup(handle);
  if (db != NULL) gDatabases[handle] = NULL;
  sqlite3_mutex_leave(gMutex);
  if (db != NULL) sqlite3_close(db);
}

int edgeSqlDelete(const char *path, char **error) {
  static const char *suffixes[] = {"", "-wal", "-shm"};
  for (int i = 0; i < 3; ++i) {
    size_t size = strlen(path) + strlen(suffixes[i]) + 1;
    char *name = sqlite3_malloc((int)size);
    if (name == NULL) {
      fail(error, "out of memory");
      return -1;
    }
    snprintf(name, size, "%s%s", path, suffixes[i]);
    /* A missing sibling is the normal case, not a failure. */
    remove(name);
    sqlite3_free(name);
  }
  return 0;
}
