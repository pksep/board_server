#!/bin/sh
set -e

VAULT_ENV_FILE="${VAULT_ENV_FILE:-/vault/secrets/runtime.env}"

if [ -f "$VAULT_ENV_FILE" ]; then
    echo "Loading runtime environment from Vault..."
    set -a
    . "$VAULT_ENV_FILE"
    set +a
fi

echo "Starting application..."
exec "$@"
