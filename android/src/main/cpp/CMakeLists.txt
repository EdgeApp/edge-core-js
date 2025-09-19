cmake_minimum_required(VERSION 3.4.1)
project("edge-core-js")

add_compile_options(-fvisibility=hidden -w)

include_directories("scrypt/")

add_library(
  edge-core-jni
  SHARED
  edge-core-jni.c
  scrypt/crypto_scrypt.c
  scrypt/sha256.c
)

# 16KiB page alignment:
target_link_options(edge-core-jni PRIVATE "-Wl,-z,max-page-size=16384")
