#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=== ScreenBridge for macOS ==="

if [ ! -d "web/dist" ]; then
  echo "Building web client..."
  npm run build -w web
fi

echo "Starting Server and Agent..."
npm run start:all
