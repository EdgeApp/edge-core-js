#ifndef EDGE_SQL_H
#define EDGE_SQL_H

/*
 * The native half of the SQL seam.
 *
 * Design:
 * https://github.com/EdgeApp/edge-plans/blob/master/2026-09/edge-core-transaction-database.md
 *
 * One C implementation serves all three platforms: Android reaches it through
 * JNI, iOS calls it from Swift through the bridging header, and Node through
 * an N-API addon. Writing it more than once would mean more than one chance to
 * get the codec setup or the value mapping subtly different, on the one code
 * path where a mistake is silent.
 *
 * Everything crosses as JSON, matching how the rest of `nativeBridge` already
 * talks. Databases are addressed by a small integer handle rather than a
 * pointer, so nothing platform-side has to hold or free native memory.
 */

/*
 * Opens a database, applying the SQLCipher-compatible codec.
 *
 * `key` is the raw database key -- 32 bytes, already full entropy, so the
 * codec is told to use it directly rather than running it through PBKDF2.
 * A `keyLength` of 0 opens without the codec, which only in-memory databases
 * may do; see the note in the implementation.
 *
 * Returns a non-negative handle, or -1 after setting `*error` to a message the
 * caller must release with `edgeSqlFree`.
 */
int edgeSqlOpen(
    const char *path,
    const unsigned char *key,
    int keyLength,
    char **error
);

/*
 * Runs statements one at a time, each committing on its own.
 *
 * `statementsJson` is `[{ "sql": "...", "params": [...] }, ...]`, where
 * `params` is optional. Returns a JSON array of per-statement change counts.
 */
char *edgeSqlExec(int handle, const char *statementsJson, char **error);

/*
 * Runs statements inside a single `BEGIN IMMEDIATE` ... `COMMIT`, rolling the
 * whole batch back if any one of them fails. Same arguments as `edgeSqlExec`.
 */
char *edgeSqlBatch(int handle, const char *statementsJson, char **error);

/*
 * Runs one query, returning a JSON array of row objects keyed by column name.
 * `paramsJson` may be NULL.
 */
char *edgeSqlQuery(
    int handle,
    const char *sql,
    const char *paramsJson,
    char **error
);

/* Closes a database. Unknown or already-closed handles are ignored. */
void edgeSqlClose(int handle);

/* Deletes a database file and its -wal / -shm siblings. */
int edgeSqlDelete(const char *path, char **error);

/* Releases any string this module returned. */
void edgeSqlFree(char *text);

#endif
