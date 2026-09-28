#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22+ is required: https://nodejs.org/en/download'
  echo 'On macOS with Homebrew: brew install node ollama git gh'
  echo 'On Linux, install Node.js with npm using your distribution or the official Node.js download.'
  exit 1
fi
node --input-type=module -e 'if(Number(process.versions.node.split(".")[0])<22)throw Error("Node.js 22+ is required")'
npm ci --ignore-scripts --no-fund
npm run launch
