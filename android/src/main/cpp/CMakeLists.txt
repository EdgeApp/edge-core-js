cmake_minimum_required(VERSION 3.4.1)
project("edge-core-js")

add_compile_options(-fvisibility=hidden -w)

include_directories("scrypt/" "sqlite3mc/")

add_library(
  edge-core-jni
  SHARED
  edge-core-jni.c
  scrypt/crypto_scrypt.c
  scrypt/sha256.c
  sqlite3mc/sqlite3mc_amalgamation.c
)

# SQLite3 Multiple Ciphers, compiled from the vendored amalgamation rather than
# linked against the system libsqlite3. Android's bundled SQLite varies by API
# level and by OEM, and frequently lacks FTS5. Building it here also means iOS,
# Android and Node all run one SQLite, so a query-planner difference cannot
# appear on device alone.
target_compile_definitions(
  edge-core-jni
  PRIVATE
  SQLITE_ENABLE_FTS5=1
  SQLITE_ENABLE_JSON1=1
  SQLITE_DQS=0
  SQLITE_THREADSAFE=1
  SQLITE_TEMP_STORE=2
  SQLITE_DEFAULT_WAL_SYNCHRONOUS=1
  SQLITE_OMIT_LOAD_EXTENSION=1
  SQLITE_OMIT_DEPRECATED=1
  SQLITE_DEFAULT_MEMSTATUS=0
)

# 16KiB page alignment:
target_link_options(edge-core-jni PRIVATE "-Wl,-z,max-page-size=16384")
