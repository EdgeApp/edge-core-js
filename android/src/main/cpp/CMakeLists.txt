cmake_minimum_required(VERSION 3.4.1)

add_compile_options(-fvisibility=hidden -w)

include_directories("scrypt/")

add_library(
  edge-core-jni
  SHARED
  edge-core-jni.c
  scrypt/crypto_scrypt.c
  scrypt/sha256.c
)
