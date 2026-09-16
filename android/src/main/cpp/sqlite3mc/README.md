# SQLite3 Multiple Ciphers

Vendored amalgamation: **SQLite3MC 2.5.1, SQLite 3.53.4** (released 2026-08-27).

Source: https://github.com/utelle/SQLite3MultipleCiphers/releases/tag/v2.5.1
Asset: `sqlite3mc-2.5.1-sqlite-3.53.4-amalgamation.zip`
SHA-256: `4125f8ff275ea953dabb3289331b20a0e76d4fc060f57148f4a5df3bf3b0d5e0`

This is stock SQLite plus a page codec. It is compiled for iOS, Android **and**
Node, so all three platforms run byte-identical SQL — there is no second SQLite
that can drift from this one.

The codec is configured as `cipher = 'sqlcipher'`, `legacy = 4`, which writes
files byte-compatible with Zetetic's SQLCipher 4. `legacy = 4` is not a
downgrade: it carries SQLCipher 4's own parameters (`kdf_iter` 256000, SHA512
KDF and HMAC) and differs only in on-disk framing. Files written *without* it
cannot be read by SQLCipher, which is what the compatibility goal requires.

Do not edit these files. To update, download the next release, verify its
SHA-256 against the published `SHA256SUMS`, and replace them wholesale.

Licence: SQLite is public domain; the SQLite3MC additions are MIT.

Design: https://github.com/EdgeApp/edge-plans/blob/master/2026-09/edge-core-transaction-database-tech-detail.md
