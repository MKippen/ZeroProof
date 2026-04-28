#!/usr/bin/env bash
set -euo pipefail

TAG_PREFIX="firmware-v"
BIN_NAME="zeroproof-esp32.bin"
JSON_NAME="firmware.json"
GITHUB_API_VERSION="2022-11-28"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEST_DIR="${REPO_ROOT}/backend/firmware"

err() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '%s\n' "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || err "Missing required command: $1"
}

sha256_file() {
  local file="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
    return
  fi

  err "Missing sha256sum or shasum; cannot verify firmware checksum"
}

json_field() {
  local file="$1"
  local field="$2"

  if command -v jq >/dev/null 2>&1; then
    jq -r --arg field "$field" '.[$field] // empty' "$file"
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$file" "$field" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

value = data.get(sys.argv[2], "")
if value is None:
    value = ""
print(value)
PY
    return
  fi

  err "Missing jq or python3; cannot parse firmware metadata"
}

detect_repo() {
  local url repo

  if [[ -n "${FIRMWARE_REPO:-}" ]]; then
    repo="${FIRMWARE_REPO}"
  else
    url="$(git -C "${REPO_ROOT}" config --get remote.origin.url 2>/dev/null || true)"
    [[ -n "${url}" ]] || err "Could not detect GitHub repo. Set FIRMWARE_REPO=owner/repo."

    case "${url}" in
      https://github.com/*)
        repo="${url#https://github.com/}"
        ;;
      http://github.com/*)
        repo="${url#http://github.com/}"
        ;;
      git@github.com:*)
        repo="${url#git@github.com:}"
        ;;
      ssh://git@github.com/*)
        repo="${url#ssh://git@github.com/}"
        ;;
      *)
        err "Unsupported remote.origin.url '${url}'. Set FIRMWARE_REPO=owner/repo."
        ;;
    esac
  fi

  repo="${repo%.git}"
  repo="${repo%/}"
  [[ "${repo}" == */* ]] || err "Invalid GitHub repo '${repo}'. Expected owner/repo."
  printf '%s\n' "${repo}"
}

REPO="$(detect_repo)"
TMP_DIR="$(mktemp -d)"
RELEASE_JSON="${TMP_DIR}/release.json"
DOWNLOAD_MODE="api"
TAG=""

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

resolve_release_with_gh() {
  if [[ -n "${FIRMWARE_TAG:-}" ]]; then
    TAG="${FIRMWARE_TAG}"
  else
    TAG="$(gh release list \
      --repo "${REPO}" \
      --limit 100 \
      --json tagName,isDraft \
      --jq "[.[] | select(.isDraft | not) | select(.tagName | startswith(\"${TAG_PREFIX}\"))][0].tagName // \"\"")" || return 1
  fi

  [[ -n "${TAG}" ]] || return 1
  [[ "${TAG}" == "${TAG_PREFIX}"* ]] || err "Firmware tag '${TAG}' must start with ${TAG_PREFIX}"
  gh release view "${TAG}" --repo "${REPO}" --json tagName >/dev/null || return 1
}

curl_json() {
  local url="$1"
  local args=(
    -fsSL
    -H "Accept: application/vnd.github+json"
    -H "X-GitHub-Api-Version: ${GITHUB_API_VERSION}"
  )

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi

  curl "${args[@]}" "${url}"
}

curl_asset() {
  local asset_id="$1"
  local output="$2"
  local args=(
    -fsSL
    -H "Accept: application/octet-stream"
    -H "X-GitHub-Api-Version: ${GITHUB_API_VERSION}"
  )

  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
  fi

  curl "${args[@]}" \
    -o "${output}" \
    "https://api.github.com/repos/${REPO}/releases/assets/${asset_id}"
}

resolve_release_with_api() {
  local api_base="https://api.github.com/repos/${REPO}/releases"

  require_cmd curl
  require_cmd jq

  if [[ -n "${FIRMWARE_TAG:-}" ]]; then
    TAG="${FIRMWARE_TAG}"
  else
    curl_json "${api_base}?per_page=100" > "${TMP_DIR}/releases.json"
    TAG="$(jq -r --arg prefix "${TAG_PREFIX}" '[.[] | select(.draft | not) | select(.tag_name | startswith($prefix))][0].tag_name // empty' "${TMP_DIR}/releases.json")"
  fi

  [[ -n "${TAG}" ]] || err "No GitHub release found with tag prefix ${TAG_PREFIX} in ${REPO}"
  [[ "${TAG}" == "${TAG_PREFIX}"* ]] || err "Firmware tag '${TAG}' must start with ${TAG_PREFIX}"
  curl_json "${api_base}/tags/${TAG}" > "${RELEASE_JSON}"
}

download_asset_with_gh() {
  local asset="$1"
  local output="${TMP_DIR}/${asset}"

  rm -f "${output}"
  gh release download "${TAG}" \
    --repo "${REPO}" \
    --pattern "${asset}" \
    --dir "${TMP_DIR}" \
    --clobber >/dev/null

  [[ -s "${output}" ]] || err "Release ${TAG} does not contain asset ${asset}"
}

download_asset_with_api() {
  local asset="$1"
  local output="${TMP_DIR}/${asset}"
  local asset_id

  asset_id="$(jq -r --arg name "${asset}" '.assets[]? | select(.name == $name) | .id' "${RELEASE_JSON}" | head -n 1)"
  [[ -n "${asset_id}" && "${asset_id}" != "null" ]] || err "Release ${TAG} does not contain asset ${asset}"

  curl_asset "${asset_id}" "${output}"
  [[ -s "${output}" ]] || err "Downloaded asset ${asset} is empty"
}

if command -v gh >/dev/null 2>&1; then
  if resolve_release_with_gh; then
    DOWNLOAD_MODE="gh"
  else
    info "gh CLI could not read the firmware release; falling back to curl + jq."
    resolve_release_with_api
  fi
else
  resolve_release_with_api
fi

info "Using firmware release ${REPO}@${TAG}"

if [[ "${DOWNLOAD_MODE}" == "gh" ]]; then
  download_asset_with_gh "${JSON_NAME}"
else
  download_asset_with_api "${JSON_NAME}"
fi

REMOTE_JSON="${TMP_DIR}/${JSON_NAME}"
REMOTE_VERSION="$(json_field "${REMOTE_JSON}" version)"
REMOTE_FILENAME="$(json_field "${REMOTE_JSON}" filename)"
REMOTE_CHECKSUM="$(json_field "${REMOTE_JSON}" checksum)"

[[ -n "${REMOTE_VERSION}" ]] || err "${JSON_NAME} is missing version"
[[ "${REMOTE_FILENAME}" == "${BIN_NAME}" ]] || err "${JSON_NAME} filename is '${REMOTE_FILENAME}', expected '${BIN_NAME}'"
[[ -n "${REMOTE_CHECKSUM}" ]] || err "${JSON_NAME} is missing checksum"

LOCAL_JSON="${DEST_DIR}/${JSON_NAME}"
LOCAL_BIN="${DEST_DIR}/${BIN_NAME}"

if [[ -f "${LOCAL_JSON}" ]]; then
  LOCAL_VERSION="$(json_field "${LOCAL_JSON}" version 2>/dev/null || true)"
  LOCAL_CHECKSUM="$(json_field "${LOCAL_JSON}" checksum 2>/dev/null || true)"

  if [[ "${LOCAL_VERSION}" == "${REMOTE_VERSION}" && "${LOCAL_CHECKSUM}" == "${REMOTE_CHECKSUM}" && -f "${LOCAL_BIN}" ]]; then
    LOCAL_ACTUAL_CHECKSUM="$(sha256_file "${LOCAL_BIN}")"
    if [[ "${LOCAL_ACTUAL_CHECKSUM}" == "${REMOTE_CHECKSUM}" ]]; then
      info "Firmware ${REMOTE_VERSION} is already installed in ${DEST_DIR}; checksum verified."
      exit 0
    fi

    info "Local firmware metadata matches ${REMOTE_VERSION}, but the binary checksum differs. Re-downloading."
  fi
fi

if [[ "${DOWNLOAD_MODE}" == "gh" ]]; then
  download_asset_with_gh "${BIN_NAME}"
else
  download_asset_with_api "${BIN_NAME}"
fi

DOWNLOADED_CHECKSUM="$(sha256_file "${TMP_DIR}/${BIN_NAME}")"
if [[ "${DOWNLOADED_CHECKSUM}" != "${REMOTE_CHECKSUM}" ]]; then
  err "Checksum mismatch for ${BIN_NAME}: expected ${REMOTE_CHECKSUM}, got ${DOWNLOADED_CHECKSUM}"
fi

mkdir -p "${DEST_DIR}"
install -m 0644 "${TMP_DIR}/${BIN_NAME}" "${LOCAL_BIN}"
install -m 0644 "${REMOTE_JSON}" "${LOCAL_JSON}"

info "Downloaded firmware ${REMOTE_VERSION} to ${DEST_DIR}"
info "Verified SHA-256 ${REMOTE_CHECKSUM}"
