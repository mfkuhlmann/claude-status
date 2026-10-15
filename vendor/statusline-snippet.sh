# >>> claude-widget >>>
# Snapshot for the Claude Status Plasma widget (plan limits + context window).
# Needs $input to hold the status-line JSON; silent and atomic, so it can't
# break the status line. The profile dir comes from the transcript path
# (<cfg>/projects/<project>/<session>.jsonl), else CLAUDE_CONFIG_DIR, links resolved.
# Runs in a subshell so the private umask and variables stay local.
(
  umask 077
  IFS=$'\t' read -r cw_sid cw_tp < <(jq -r '[.session_id // "", .transcript_path // ""] | @tsv' <<<"$input")
  cw_cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  [[ "$cw_tp" == */projects/* ]] && cw_cfg="${cw_tp%/projects/*}"
  cw_cfg="${cw_cfg%/}"
  # A link like ~/.claude can be switched to another profile: file the
  # snapshot under the real folder, so it can't be credited to the wrong one.
  cw_cfg=$(realpath -e -- "$cw_cfg" 2>/dev/null || printf '%s' "$cw_cfg")
  case "$cw_sid" in ''|*[!A-Za-z0-9_-]*) ;; *)
    cw_dir="${XDG_CACHE_HOME:-$HOME/.cache}/claude-widget/statusline/${cw_cfg##*/}"
    mkdir -p "$cw_dir" &&
      printf '%s' "$input" > "$cw_dir/.$cw_sid.tmp" &&
      mv -f "$cw_dir/.$cw_sid.tmp" "$cw_dir/$cw_sid.json"
  ;; esac
) 2>/dev/null
# <<< claude-widget <<<
