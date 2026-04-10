#!/bin/sh
set -e

if [ "$RUN_DB_SETUP" = "true" ]; then
    echo "⚠️  RUN_DB_SETUP is true. Running database setup..."
    bun bin/deploy/delete-create-db.mjs
else
    echo "Skipping database setup (RUN_DB_SETUP is not true)."
fi
 
echo "Running migrations..."
bun run migrate:up

echo "Starting PM2..."
exec "$@"