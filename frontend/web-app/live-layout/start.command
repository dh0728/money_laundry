#!/bin/zsh
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:$PATH"
exec ../node_modules/.bin/vite --config vite.config.mjs
