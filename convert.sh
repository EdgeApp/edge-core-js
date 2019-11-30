set -e

for x in $(find src test -name '*.js'); do
  echo Stripping $x
  tsname=$(echo $x | sed s/js$/ts/)
  cat $x |
    # Change `+x` to `readonly x`:
    sed -E 's/^ *[+](\[?[_a-zA-Z0-9]+)/readonly \1/' |

    # Fix exact types:
    sed -e 's/{|/{/' |
    sed -e 's/|}/}/' |

    # Fix differently-named types:
    sed -e 's/mixed/unknown/g' |
    sed -e 's/\| void/| undefined/g' |
    sed -e 's/ Iterator</ IterableIterator</g' |
    sed -e 's/TimeoutID/ReturnType<typeof setTimeout>/g' |
    sed -e 's/declare export/export declare/g' |
    sed -e 's/declare var/declare const/g' |
    sed -e 's/React$Element<any>/JSX.Element/g' |

    # Add catch annotations:
    sed -e 's/} catch (error) {/} catch (error: any) {/g' |

    # Fix utility types:
    sed -E 's/\$PropertyType<([^,]*),([^>]*)>/\1[\2]/' |
    sed -e 's/$Shape</Partial</' |

    # Fix `import type` syntax:
    sed -e 's/import type/import/' |
    sed -E 's/type ([_a-zA-Z0-9]+)($|,| [^=])/\1\2/g' |

    # Remove shims:
    sed -e 's!.*// @ts-delete!!' |

    # We aren't JS anymore:
    sed -e 's!// $FlowFixMe!// @ts-expect-error!' |
    sed -e 's!// @flow!!' |
    sed -e "s/[.]js'$/'/" |
    sed -e "s/from 'hash'/from 'hash.js'/"> $tsname

  if cat $x | grep -q -E '</|/>'; then
    mv $tsname ${tsname}x
  fi
  rm $x
done

yarn fix
git add -- src test
git rm ./convert.sh
git commit -m "x ./convert.sh" --no-verify
