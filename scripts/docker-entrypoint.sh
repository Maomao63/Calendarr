#!/bin/sh
set -eu

config_file="${CONFIG_FILE:-/config/config.json}"
config_directory=$(dirname "$config_file")

mkdir -p "$config_directory"
chown node:node "$config_directory"

if [ ! -f "$config_file" ]; then
  cp /defaults/config.json "$config_file"
  chown node:node "$config_file"
  echo "Created initial Calendarr configuration at $config_file"
fi

exec su-exec node "$@"
