#!/usr/bin/env bash
# Create the rclone remote used by upload_to_r2.py, asking for the R2 API
# token values interactively. The secret is not echoed, nothing goes into
# shell history, and the keys end up only in rclone's own config file
# (~/.config/rclone/rclone.conf, readable by you only).
#
# Usage: bash scripts/setup_r2_remote.sh [remote-name] [bucket]
#        defaults: r2  soundscape-atlas-audio

set -euo pipefail

remote="${1:-r2}"
bucket="${2:-soundscape-atlas-audio}"

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone is not installed. Install it first:  sudo apt install rclone" >&2
  exit 1
fi

if rclone listremotes | grep -qx "${remote}:"; then
  read -r -p "An rclone remote called '${remote}' already exists. Replace it? [y/N] " answer
  if [[ ! "${answer}" =~ ^[Yy] ]]; then
    echo "Left the existing remote unchanged."
    exit 0
  fi
  rclone config delete "${remote}"
fi

echo "Paste the values from your R2 API token (Object Read & Write on '${bucket}')."
read -r -p "Access Key ID: " key_id
read -r -s -p "Secret Access Key (hidden while you paste): " secret
echo
read -r -p "S3 endpoint, e.g. https://<account-id>.r2.cloudflarestorage.com (or just the account ID): " endpoint

key_id="$(printf '%s' "${key_id}" | tr -d '[:space:]')"
secret="$(printf '%s' "${secret}" | tr -d '[:space:]')"
endpoint="$(printf '%s' "${endpoint}" | tr -d '[:space:]')"
if [[ -z "${key_id}" || -z "${secret}" || -z "${endpoint}" ]]; then
  echo "All three values are needed; nothing was saved." >&2
  exit 1
fi
# Accept a bare account ID, and drop any bucket path the dashboard appends.
if [[ "${endpoint}" != https://* ]]; then
  endpoint="https://${endpoint}.r2.cloudflarestorage.com"
fi
endpoint="$(printf '%s' "${endpoint}" | sed -E 's#^(https://[^/]+).*#\1#')"

rclone config create "${remote}" s3 \
  provider=Cloudflare \
  access_key_id="${key_id}" \
  secret_access_key="${secret}" \
  endpoint="${endpoint}" \
  acl=private \
  no_check_bucket=true \
  no_head=true >/dev/null
unset secret

echo "Saved rclone remote '${remote}' (endpoint ${endpoint})."
echo "Checking access to ${remote}:${bucket} ..."
if rclone lsf "${remote}:${bucket}" --max-depth 1 >/dev/null; then
  echo "OK: the token can reach ${bucket}."
else
  echo "Could not list ${bucket}. Check the bucket name, and that the token has Object Read & Write on it." >&2
  exit 1
fi
