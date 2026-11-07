#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

if [[ "$(uname -s)" != Linux ]]; then
  echo "Run this bootstrap from Linux or WSL; unsupported host OS: $(uname -s)" >&2
  exit 1
fi
wsl=0
case "$(uname -r)" in *microsoft*|*Microsoft*) wsl=1 ;; esac

ask() {
  local answer
  [[ -t 0 ]] || return 1
  read -r -p "$1 [y/N] " answer
  [[ "$answer" == [yY] || "$answer" == [yY][eE][sS] ]]
}

compose=(dotenvx run --strict --overload -f .env.development -fk .env.keys -- docker compose --env-file /dev/null)
"${compose[@]}" up --build --detach --wait || {
  echo 'Development Compose did not become healthy. Inspect with: bun run dev' >&2
  exit 1
}

resolve_loopback() {
  local result
  result=$(getent ahostsv4 auth.localhost 2>/dev/null | cut -d' ' -f1 | sort -u || true)
  [[ -n "$result" ]] && ! printf '%s\n' "$result" | grep -Ev '^127\.'
}

if ! resolve_loopback; then
  echo 'auth.localhost does not resolve exclusively to IPv4 loopback.' >&2
  if ask 'Add 127.0.0.1 auth.localhost to /etc/hosts using sudo?'; then
    sudo -v
    if ! grep -Eq '^[[:space:]]*127\.0\.0\.1[[:space:]]+([^#[:space:]]+[[:space:]]+)*auth\.localhost([[:space:]]|$)' /etc/hosts; then
      printf '\n127.0.0.1 auth.localhost\n' | sudo tee -a /etc/hosts >/dev/null
    fi
  else
    echo 'Add this line to the active host resolver, then rerun bun run dev:setup:' >&2
    echo '127.0.0.1 auth.localhost' >&2
    if ((wsl)); then
      echo 'Add it to both WSL /etc/hosts and Windows %SystemRoot%\\System32\\drivers\\etc\\hosts.' >&2
      echo 'WSL may regenerate /etc/hosts at restart; rerun setup if resolution fails.' >&2
    fi
    exit 1
  fi
fi

if ! resolve_loopback; then
  echo 'auth.localhost still does not resolve to loopback; check the active resolver and retry.' >&2
  exit 1
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
"${compose[@]}" cp caddy:/data/caddy/pki/authorities/local/root.crt "$tmp"
if [[ ! -s "$tmp" ]] || ! openssl x509 -in "$tmp" -noout -subject >/dev/null 2>&1; then
  echo 'Caddy public CA root is missing or invalid. Check Caddy logs; do not remove its volume.' >&2
  exit 1
fi
bun scripts/export-public-ca.ts "$tmp" "$root/central-identity-root.crt"

trust_linux_ca() {
  local cert_dir=/usr/local/share/ca-certificates
  local installed="$cert_dir/central-identity-local.crt"
  if command -v update-ca-certificates >/dev/null 2>&1; then
    if [[ -f "$installed" ]] && cmp -s "$root/central-identity-root.crt" "$installed"; then
      echo 'Public CA already installed in Linux system trust.'
      return
    fi
    if ! ask 'Install or update this public CA in the Linux system trust store?'; then
      echo 'Linux system trust is required; approve installation and rerun setup.' >&2
      return 1
    fi
    sudo -v
    sudo install -d "$cert_dir"
    sudo install -m 0644 "$root/central-identity-root.crt" "$installed"
    sudo update-ca-certificates
  else
    echo 'Install ca-certificates (providing update-ca-certificates), then rerun setup.' >&2
    return 1
  fi
}

trust_linux_ca
trust_chromium_ca() {
  local db="$HOME/.pki/nssdb"
  local name='Central Identity local development'
  local current installed
  if ! command -v certutil >/dev/null 2>&1; then
    echo 'Install libnss3-tools (Debian/Ubuntu) or nss-tools (Fedora) for Chromium CA trust, then rerun setup.' >&2
    return 1
  fi
  mkdir -p "$db"
  if [[ ! -f "$db/cert9.db" ]]; then
    certutil -N --empty-password -d "sql:$db"
  fi
  current=$(openssl x509 -in "$root/central-identity-root.crt" -noout -fingerprint -sha256)
  installed=$(certutil -L -d "sql:$db" -n "$name" -a 2>/dev/null | openssl x509 -noout -fingerprint -sha256 2>/dev/null || true)
  if [[ "$installed" == "$current" ]]; then
    echo 'Public CA already trusted by Chromium.'
    return
  fi
  if ! ask 'Trust this public CA in your Chromium user certificate store?'; then
    echo 'Chromium trust is required; approve installation and rerun setup.' >&2
    return 1
  fi
  if certutil -L -d "sql:$db" -n "$name" -a >/dev/null 2>&1; then
    certutil -D -d "sql:$db" -n "$name"
  fi
  certutil -A -d "sql:$db" -n "$name" -t 'C,,' -i "$root/central-identity-root.crt"
  installed=$(certutil -L -d "sql:$db" -n "$name" -a | openssl x509 -noout -fingerprint -sha256)
  if [[ "$installed" != "$current" ]]; then
    echo 'Chromium trust store did not retain the active Caddy CA.' >&2
    return 1
  fi
}

trust_chromium_ca
if ((wsl)); then
  win_cert=$(wslpath -w "$root/central-identity-root.crt")
  echo 'Windows browsers need this public root in the Windows Trusted Root store.'
  echo "Run in elevated PowerShell: Import-Certificate -FilePath '$win_cert' -CertStoreLocation Cert:\LocalMachine\Root"
  if ask 'Have you installed the CA in Windows Trusted Root?'; then :; else
    echo 'Install the CA for the Windows browser, then rerun setup.' >&2
    exit 1
  fi
fi

export NODE_EXTRA_CA_CERTS="$root/central-identity-root.crt"
for attempt in {1..30}; do
  if curl --fail --silent --show-error 'https://auth.localhost:8080/health/ready' >/dev/null; then break; fi
  sleep 2
done
if ! curl --fail --silent --show-error 'https://auth.localhost:8080/health/ready' >/dev/null; then
  echo 'Trusted HTTPS health check failed. Verify DNS, CA trust, and Compose logs.' >&2
  "${compose[@]}" logs --tail=80 caddy auth web >&2
  exit 1
fi
issuer=$(curl --fail --silent --show-error 'https://auth.localhost:8080/api/auth/.well-known/openid-configuration' | bun -e 'const data=await Bun.stdin.json(); console.log(data.issuer)')
if [[ "$issuer" != 'https://auth.localhost:8080/api/auth' ]]; then
  echo "Unexpected OIDC issuer: $issuer" >&2
  exit 1
fi

bidding="$root/../book-bidding"
if [[ ! -d "$bidding/node_modules/playwright" ]]; then
  echo 'Chromium trust check unavailable: install Book Bidding dependencies and its Playwright Chromium browser, then rerun setup.' >&2
  exit 1
fi
(
  cd "$bidding"
  NODE_EXTRA_CA_CERTS="$root/central-identity-root.crt" node --input-type=module -e '
    import { chromium } from "playwright";
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const response = await page.goto("https://auth.localhost:8080/api/auth/.well-known/openid-configuration");
      if (!response?.ok()) throw new Error(`Discovery returned HTTP ${response?.status()}`);
      const data = await response.json();
      if (data.issuer !== "https://auth.localhost:8080/api/auth") throw new Error(`Unexpected issuer: ${data.issuer}`);
    } finally { await browser.close(); }
  '
) || {
  echo 'Chromium could not validate HTTPS discovery. Check browser CA trust and install the Playwright browser.' >&2
  exit 1
}

echo 'Trusted local HTTPS and OIDC discovery verified; Chromium trusts the active Caddy CA.'
