#!/usr/bin/env sh
set -eu
case "$(uname -r)" in
  *microsoft*|*Microsoft*) ip -j -4 route get 1.1.1.1 | jq -r '.[0].prefsrc' ;;
  *) printf '%s\n' host-gateway ;;
esac
