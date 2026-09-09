#!/usr/bin/env bash
# Container entrypoint: map a short verb to the n-seo CLI, always against the
# mounted instance. Anything not listed is passed straight through, so
# `docker run … n-seo version` and `… n-seo daily --only probe` both work.
#
# Note on style: every conditional below is a full if/then. Under `set -e` a
# bare `[ test ] && cmd` whose test is false makes the shell exit, which would
# have killed `serve` on any host that does not set PORT.
set -euo pipefail

ENGINE=/engine
CLI="$ENGINE/bin/n-seo.mjs"
INSTANCE="${N_SEO_INSTANCE:-/instance}"

cmd="${1:-serve}"
if [ $# -gt 0 ]; then shift; fi

cli() { exec node "$CLI" "$1" --instance "$INSTANCE" "${@:2}"; }

# serve/daily/cron are useless without a config, and the failure mode without
# this check is a dashboard quietly serving the example config.
require_config() {
  if [ ! -f "$INSTANCE/n-seo.config.json" ]; then
    cat >&2 <<MSG
n-seo: no config found at $INSTANCE/n-seo.config.json

The instance volume looks empty. Scaffold it once, with the same volume
mounted, then edit the config before starting:

  docker run --rm -v <volume>:/instance <image> init

See docs/SETUP-GOOGLE.md for the Google access the config needs.
MSG
    exit 78   # EX_CONFIG
  fi
}

case "$cmd" in
  serve)
    require_config
    # The container boundary is the network edge here; whatever publishes the
    # port is responsible for authenticating it.
    export SEO_HOST="${SEO_HOST:-0.0.0.0}"
    # Cloud Run and friends inject PORT.
    if [ -n "${PORT:-}" ]; then export SEO_PORT="$PORT"; fi
    cli start "$@"
    ;;

  cron)
    require_config
    at="${N_SEO_DAILY_AT:-07:00}"
    if ! date -d "today $at" +%s >/dev/null 2>&1; then
      echo "n-seo cron: N_SEO_DAILY_AT='$at' is not a time this shell understands (want HH:MM)" >&2
      exit 2
    fi
    echo "n-seo cron: daily run scheduled for $at (${TZ:-UTC}) — instance $INSTANCE"
    while true; do
      # Recomputed from the clock every iteration, so neither a long run nor a
      # slow sleep can make the schedule drift.
      now=$(date +%s)
      next=$(date -d "today $at" +%s)
      if [ "$next" -le "$now" ]; then
        next=$(date -d "tomorrow $at" +%s)
      fi
      wait_for=$((next - now))
      echo "n-seo cron: next run $(date -d "@$next" '+%Y-%m-%d %H:%M:%S %Z') (in ${wait_for}s)"
      sleep "$wait_for"
      echo "n-seo cron: starting daily run $(date '+%Y-%m-%d %H:%M:%S %Z')"
      # A failed run must not kill the scheduler: the run reports its own
      # failures, and tomorrow's attempt is the retry.
      if node "$CLI" daily --instance "$INSTANCE" "$@"; then
        echo "n-seo cron: daily run finished OK"
      else
        echo "n-seo cron: daily run FAILED (exit $?) — staying scheduled" >&2
      fi
    done
    ;;

  daily)
    require_config
    cli daily "$@"
    ;;

  # doctor is what you run when the config is missing or wrong, and init is
  # what creates it, so neither may require one.
  *)
    cli "$cmd" "$@"
    ;;
esac
