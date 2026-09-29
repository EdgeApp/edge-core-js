# scrypt

This source code has been extracted from the
[scrypt command-line utility](https://www.tarsnap.com/scrypt.html)
and turned into a standalone library.

The original locations in the scrypt-1.1.6.tgz file are:

- lib/crypto/crypto_scrypt-ref.c
- lib/crypto/crypto_scrypt.h
- lib/crypto/sha256.c
- lib/crypto/sha256.h
- lib/util/sysendian.h

Local changes:

- `sha256.h` renames its functions with an `edge_scrypt_` prefix,
  so they cannot collide with OpenSSL's `SHA256_*` symbols when every native library is linked into one iOS image.
