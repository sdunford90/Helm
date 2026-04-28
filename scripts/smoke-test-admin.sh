#!/usr/bin/env bash
# Post-deploy smoke check for the admin / web SPA host routing wired into
# Dockerfile.web + nginx.conf (and apps/frontend-server/server.js).
#
# Asserts:
#   1. ADMIN_URL/                -> 200 + body contains "<title>Helm Admin</title>"
#   2. ADMIN_URL/tenants/abc-123 -> 200 + same title (SPA fallback works)
#   3. WEB_URL/                  -> 200 + "<title>Helm</title>" and NOT "Helm Admin"
#
# Env: ADMIN_URL, WEB_URL, RETRIES (default 5), RETRY_WAIT (default 10s),
#      CURL_OPTS (extra curl args).
# Exits non-zero on first persistent failure.

set -u
set -o pipefail

ADMIN_URL="${ADMIN_URL:-https://admin.tracktheturn.com}"
WEB_URL="${WEB_URL:-https://app.tracktheturn.com}"
RETRIES="${RETRIES:-5}"
RETRY_WAIT="${RETRY_WAIT:-10}"
CURL_OPTS="${CURL_OPTS:-}"

ADMIN_URL="${ADMIN_URL%/}"
WEB_URL="${WEB_URL%/}"

ADMIN_TITLE='<title>Helm Admin</title>'
WEB_TITLE='<title>Helm</title>'
DEEP_LINK_PATH='/tenants/abc-123'

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

fetch() {
    local url="$1"
    # shellcheck disable=SC2086
    curl --silent --show-error --location \
        --max-time 15 \
        --write-out '\n__HTTP_STATUS__:%{http_code}\n' \
        $CURL_OPTS \
        "$url"
}

# run_check <description> <url> <expected_status> <expected_substring> [<forbidden_substring>]
run_check() {
    local desc="$1"
    local url="$2"
    local expected_status="$3"
    local expected_substring="$4"
    local forbidden_substring="${5:-}"

    local attempt=1
    local response status body

    while [ "$attempt" -le "$RETRIES" ]; do
        printf '  [attempt %d/%d] %s -> %s ... ' "$attempt" "$RETRIES" "$desc" "$url"

        if ! response="$(fetch "$url" 2>&1)"; then
            yellow "curl error"
            printf '    %s\n' "$response"
        else
            status="$(printf '%s' "$response" | awk -F: '/^__HTTP_STATUS__:/{print $2}' | tail -1 | tr -d '[:space:]')"
            body="$(printf '%s' "$response" | sed '/^__HTTP_STATUS__:/d')"

            if [ "$status" != "$expected_status" ]; then
                yellow "got HTTP $status, expected $expected_status"
            elif ! printf '%s' "$body" | grep -qF "$expected_substring"; then
                yellow "missing expected substring"
                printf '    expected: %s\n' "$expected_substring"
            elif [ -n "$forbidden_substring" ] && printf '%s' "$body" | grep -qF "$forbidden_substring"; then
                yellow "found forbidden substring"
                printf '    forbidden: %s\n' "$forbidden_substring"
            else
                green "OK (HTTP $status, contains '$expected_substring')"
                return 0
            fi
        fi

        if [ "$attempt" -lt "$RETRIES" ]; then
            sleep "$RETRY_WAIT"
        fi
        attempt=$((attempt + 1))
    done

    red "FAIL: $desc"
    printf '  url: %s\n' "$url"
    printf '  expected HTTP %s, body containing: %s\n' "$expected_status" "$expected_substring"
    if [ -n "$forbidden_substring" ]; then
        printf '  body must NOT contain: %s\n' "$forbidden_substring"
    fi
    if [ -n "${body:-}" ]; then
        printf '  last body (first 300 chars):\n    %s\n' "$(printf '%s' "$body" | head -c 300 | tr '\n' ' ')"
    fi
    return 1
}

echo "==> Helm post-deploy smoke test"
echo "    admin: $ADMIN_URL"
echo "    web:   $WEB_URL"
echo "    retries=$RETRIES, retry_wait=${RETRY_WAIT}s"
echo

failures=0

run_check "admin root serves admin bundle" \
    "$ADMIN_URL/" 200 "$ADMIN_TITLE" \
    || failures=$((failures + 1))

run_check "admin deep link falls back to admin index.html" \
    "$ADMIN_URL$DEEP_LINK_PATH" 200 "$ADMIN_TITLE" \
    || failures=$((failures + 1))

# "Helm" is a strict prefix of "Helm Admin", so explicitly forbid the
# admin title to make sure we didn't get routed to the wrong bundle.
run_check "web root still serves marina bundle (not admin)" \
    "$WEB_URL/" 200 "$WEB_TITLE" "Helm Admin" \
    || failures=$((failures + 1))

echo
if [ "$failures" -ne 0 ]; then
    red "==> Smoke test FAILED ($failures check(s) failed)"
    exit 1
fi

green "==> Smoke test passed"
exit 0
