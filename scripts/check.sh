#!/bin/sh
set -u

repo_root=$(CDPATH= cd "$(dirname "$0")/.." && pwd) || exit 1
cd "$repo_root" || exit 1

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    printf '%s\n' 'Node.js and npm are required. Install Node.js 22 or newer.' >&2
    exit 1
fi

failed_checks=""
check_logs=$(mktemp -d "${TMPDIR:-/tmp}/icyoa-checks.XXXXXX") || exit 1
trap 'rm -rf "$check_logs"' 0
trap 'exit 1' 1 2 15

printf '%s\n' 'Checking CYOA data first...'
for check in test:cyoas check:js test:validation test:functional test:versions test:ids test:commits; do
    check_log="$check_logs/$check.log"
    if npm_config_update_notifier=false npm run "$check" >"$check_log" 2>&1; then
        printf 'PASS %s\n' "$check"
        if [ "${GITHUB_ACTIONS:-}" = true ]; then
            printf '::group::Passed: %s (details)\n' "$check"
            cat "$check_log"
            printf '%s\n' '::endgroup::'
        fi
    else
        failed_checks="$failed_checks $check"
        printf '\nFAIL %s\n' "$check" >&2
        if [ "${GITHUB_ACTIONS:-}" = true ]; then
            cat "$check_log"
        else
            cat "$check_log" >&2
        fi
    fi
done

if [ -n "$failed_checks" ]; then
    case "$failed_checks" in
        *test:cyoas*)
            printf '\n%s\n' '=== CYOA ERRORS TO FIX ===' >&2
            if [ "${GITHUB_ACTIONS:-}" = true ]; then
                sed '/^::error /d; /^::warning /d' "$check_logs/test:cyoas.log" >&2
            else
                cat "$check_logs/test:cyoas.log" >&2
            fi
            ;;
    esac
    printf '\nFailed checks:%s\n' "$failed_checks" >&2
    exit 1
fi

printf '\n%s\n' 'All checks passed.'
