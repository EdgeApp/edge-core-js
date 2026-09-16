{
  "targets": [
    {
      "target_name": "edge_sql",
      "sources": [
        "native/edge_sql_napi.c",
        "android/src/main/cpp/edge-sql.c",
        "android/src/main/cpp/sqlite3mc/sqlite3mc_amalgamation.c"
      ],
      "include_dirs": [
        "android/src/main/cpp",
        "android/src/main/cpp/sqlite3mc"
      ],
      "defines": [
        "SQLITE_ENABLE_FTS5=1",
        "SQLITE_ENABLE_JSON1=1",
        "SQLITE_DQS=0",
        "SQLITE_THREADSAFE=1",
        "SQLITE_TEMP_STORE=2",
        "SQLITE_DEFAULT_WAL_SYNCHRONOUS=1",
        "SQLITE_OMIT_LOAD_EXTENSION=1",
        "SQLITE_OMIT_DEPRECATED=1",
        "SQLITE_DEFAULT_MEMSTATUS=0"
      ],
      "cflags": ["-w"],
      "xcode_settings": {
        "OTHER_CFLAGS": ["-w"],
        "MACOSX_DEPLOYMENT_TARGET": "11.0"
      }
    }
  ]
}
