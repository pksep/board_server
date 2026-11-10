#!/bin/sh
set -e

echo "Checking and applying pending migrations..."
node dist/scripts/migrations/umzug.js --to=up

echo "Migrations verified. Starting application..."
exec "$@"
