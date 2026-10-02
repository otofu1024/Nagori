#!/bin/sh
set -eu
action=$1
source=$2
destination=$3
fail() { printf '%s\n' "$2" >&2; exit "$1"; }

# Never replace another command, including a dangling symlink.
if [ -L "$destination" ]; then
    [ "$(/usr/bin/readlink "$destination")" = "$source" ] || fail 17 '別のコマンドが登録されています。既存の登録を確認してください。'
    [ "$action" = install ] && exit 0
elif [ -e "$destination" ]; then
    fail 17 '別のコマンドが登録されています。既存の登録を確認してください。'
elif [ "$action" = uninstall ]; then
    exit 0
fi
case "$action" in
    install)
        [ -f "$source" ] && [ -x "$source" ] || fail 22 'アプリ内の起動スクリプトがありません。'
        /bin/mkdir -p -- "$(/usr/bin/dirname "$destination")" || fail 13 'コマンドの登録先に書き込めません。'
        # No -f: if a command appears after our check, preserve it.
        /bin/ln -s -- "$source" "$destination" || {
            if [ -e "$destination" ] || [ -L "$destination" ]; then
                fail 17 '別のコマンドが登録されています。既存の登録を確認してください。'
            fi
            fail 13 'コマンドを登録できません。'
        }
        ;;
    uninstall) /bin/rm -- "$destination" || fail 13 'コマンドの登録を解除できません。' ;;
    *) fail 22 '不明なコマンド操作です。' ;;
esac
