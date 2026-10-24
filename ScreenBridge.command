#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "========================================"
echo " Starting ScreenBridge on macOS"
echo "========================================"

# Check node
if ! command -v node &> /dev/null; then
    echo "Node.js is not found. Please install Node.js from https://nodejs.org/"
    read -p "Press Enter to exit..."
    exit 1
fi

# Build web UI if not built
if [ ! -d "web/dist" ]; then
    echo "Building web client..."
    npm install
    npm run build
fi

# Start services
echo "Launching ScreenBridge Server & Companion Agent..."
npm run start:all &
SERVER_PID=$!

sleep 2

# Open default browser
open "http://localhost:8787"

echo ""
echo "ScreenBridge is running!"
echo "Open http://localhost:8787 in your browser or scan the QR code from another device."
echo "Press Ctrl+C to stop."

trap "kill $SERVER_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait $SERVER_PID
