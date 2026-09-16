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

/*
 * Fences every later statement on this handle to one plugin and one wallet.
 *
 * Passing NULL for `pluginId` restores unrestricted core access, which is the
 * state a handle opens in.
 *
 * Two mechanisms, because neither can do the other's job. The authorizer sees
 * table and column *names* but never values, so it fences which tables the SQL
 * may name at all -- `walletPrefix` is what its own tables are called. Row
 * scoping comes from `tx_chain_scoped`, a core-owned view filtered by
 * `edge_wallet()` whose INSTEAD OF triggers substitute the wallet on write, so
 * a plugin cannot reach another wallet's rows even by naming them.
 *
 * Returns 0, or -1 after setting `*error`.
 */
int edgeSqlSetScope(
    int handle,
    const char *pluginId,
    const char *walletPrefix,
    const char *walletId,
    char **error
);

/*
 * Attaches another database file to this connection, read-only.
 *
 * `name` is a bare database name, resolved the same way `edgeSqlOpen` does,
 * so a caller never handles a path. The attached file carries no key: this
 * exists for the device-wide rate cache, which is public market data and
 * deliberately unencrypted.
 *
 * Returns 0, or -1 after setting `*error`.
 */
int edgeSqlAttach(
    int handle,
    const char *path,
    const char *alias,
    char **error
);

/* Closes a database. Unknown or already-closed handles are ignored. */
void edgeSqlClose(int handle);

/* Deletes a database file and its -wal / -shm siblings. */
int edgeSqlDelete(const char *path, char **error);

/* Releases any string this module returned. */
void edgeSqlFree(char *text);

#endif
