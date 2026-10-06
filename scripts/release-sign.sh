#!/bin/sh
# 外部配布用のDeveloper ID署名と公証を行うビルド手順。
# 証明書と資格情報は環境変数だけで受け取る。リポジトリには何も書かない。
# 必要な環境変数が足りない場合は、何も署名・ビルドせずに案内して終了する。
#
# 使い方:
#   scripts/release-sign.sh --check   環境変数と証明書の確認だけを行う（ビルドしない）
#   scripts/release-sign.sh           署名・公証つきでReleaseアプリとDMGを生成する
set -eu

mode=${1:-build}
case "$mode" in
    build|--check) ;;
    *) printf '%s\n' '使い方: scripts/release-sign.sh [--check]' >&2; exit 64 ;;
esac

cd "$(dirname "$0")/.."

# 案内を出して終了する。終了コード2は「署名できる環境ではない」を表す。
guide() {
    cat >&2 <<'MSG'
外部配布用の署名・公証を実行できないため、何も署名せずに終了します。

必要な環境変数
  APPLE_SIGNING_IDENTITY  例: Developer ID Application: 名前 (チームID)
                          キーチェーンにある証明書の名前を指定する
公証の資格情報（次のどちらか一組）
  A. APPLE_ID, APPLE_PASSWORD（App用パスワード）, APPLE_TEAM_ID
  B. APPLE_API_ISSUER, APPLE_API_KEY, APPLE_API_KEY_PATH

通常のローカル試用ビルド（ad-hoc署名）は npm run tauri build -- --bundles app,dmg --ci です。
手順の詳細はREADME.mdの「外部配布用の署名と公証」を参照してください。
MSG
    exit 2
}

[ -n "${APPLE_SIGNING_IDENTITY:-}" ] || {
    printf '%s\n' 'APPLE_SIGNING_IDENTITY が未設定です。' >&2
    guide
}
[ "$APPLE_SIGNING_IDENTITY" != "-" ] || {
    printf '%s\n' 'APPLE_SIGNING_IDENTITY が - (ad-hoc) です。Developer ID Applicationの証明書名を指定してください。' >&2
    guide
}

# 公証の資格情報が一組そろっているか確認する。
if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
    notary=apple-id
elif [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_KEY_PATH:-}" ]; then
    [ -f "$APPLE_API_KEY_PATH" ] || {
        printf '%s\n' 'APPLE_API_KEY_PATH のファイルが見つかりません。' >&2
        guide
    }
    notary=api-key
else
    printf '%s\n' '公証の資格情報が足りません。' >&2
    guide
fi

# 指定した証明書がキーチェーンに存在することを確認する。
/usr/bin/security find-identity -v -p codesigning | /usr/bin/grep -F -- "$APPLE_SIGNING_IDENTITY" >/dev/null || {
    printf '%s\n' '指定した署名証明書がキーチェーンに見つかりません。' >&2
    guide
}

printf '%s\n' "署名証明書と公証資格情報（$notary）を確認しました。"
[ "$mode" = --check ] && exit 0

# Tauriは上記の環境変数を読み、署名、公証、ステープルまで行う。
npm run tauri build -- --bundles app,dmg --ci

app=src-tauri/target/release/bundle/macos/Nagori.app
/usr/bin/codesign --verify --deep --strict --verbose=2 "$app"
/usr/sbin/spctl --assess --type execute --verbose=2 "$app"
/usr/bin/xcrun stapler validate "$app"
printf '%s\n' '署名・公証の検証が成功しました。DMGはsrc-tauri/target/release/bundle/dmgにあります。'
