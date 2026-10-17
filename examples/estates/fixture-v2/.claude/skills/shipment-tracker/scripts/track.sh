#!/bin/sh
# Look up one shipment. Usage: ./scripts/track.sh <carrier code> <tracking number>
# Prints the last scan and the promised date. A fake for testing: it reads the local table ../data/shipments.txt.
if [ "$#" -ne 2 ]; then
  echo "usage: track.sh <carrier code> <tracking number>" >&2
  exit 2
fi
grep "^$1 $2 " "$(dirname "$0")/../data/shipments.txt" || { echo "no shipment $1 $2" >&2; exit 1; }
