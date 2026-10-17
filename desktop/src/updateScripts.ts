/** Runs after the app exits (args: pid staged dest [opener]): swaps the staged bundle in, drops the backup, reopens; rolls back on failure. */
export const MAC_SWAP_SCRIPT = [
  'pid="$1"; staged="$2"; dest="$3"; opener="${4:-open}"; backup="$dest.previous-$pid"',
  'while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done',
  'if mv "$dest" "$backup" && mv "$staged" "$dest"; then rm -rf "$backup" 2>/dev/null',
  'else [ -d "$backup" ] && [ ! -d "$dest" ] && mv "$backup" "$dest"; rm -rf "$staged" 2>/dev/null; fi',
  '"$opener" "$dest"',
].join("\n");

/** Runs after the app exits (args: pid staged dest grace): keeps the old AppImage as `.previous`, launches the new one and restores the old one if it dies within `grace` seconds. */
export const LINUX_SWAP_SCRIPT = [
  'pid="$1"; staged="$2"; dest="$3"; grace="${4:-8}"; previous="$dest.previous"',
  'unset APPIMAGE APPDIR ARGV0 OWD',
  'while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done',
  'rm -f "$previous"',
  'if mv "$dest" "$previous" && mv "$staged" "$dest"; then',
  '  "$dest" >/dev/null 2>&1 &',
  '  child=$!; sleep "$grace"',
  '  if ! kill -0 "$child" 2>/dev/null; then',
  '    wait "$child"; status=$?',
  '    if [ "$status" -ne 0 ]; then rm -f "$dest"; mv "$previous" "$dest"; "$dest" >/dev/null 2>&1 & fi',
  '  fi',
  'else',
  '  [ -e "$previous" ] && [ ! -e "$dest" ] && mv "$previous" "$dest"; rm -f "$staged"',
  '  "$dest" >/dev/null 2>&1 &',
  'fi',
].join("\n");
