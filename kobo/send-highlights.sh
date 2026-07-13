#!/bin/sh
# PaperFolio — 在 Kobo 上一鍵把畫線推到 Mac 上 Obsidian 外掛的接收端（同一個 WiFi / LAN）。
# 由 NickelMenu 觸發；先 :nickel_wifi :autoconnect 連上 WiFi 再跑本腳本（背景）。
#
# 安裝時把下面兩行填成外掛設定頁「無線接收」顯示的「你的同步位址」與「接收密鑰」。

DIR="/mnt/onboard/.adds/folio"
DB="/mnt/onboard/.kobo/KoboReader.sqlite"

# === 這兩行安裝時填 ===
URL="http://REPLACE-ME-IP:8322/sync"   # 你 Mac 的 LAN 同步位址（例 http://192.168.1.108:8322/sync）
TOKEN="REPLACE-ME-TOKEN"               # PaperFolio 接收密鑰
# ======================

# onboard 是 FAT32、可能不能直接 exec：把 curl 複製到 /tmp（tmpfs 可執行）再跑。
# 若 Kobo 韌體已內建 curl，會自動退回系統 curl。
CURL=""
if [ -f "$DIR/curl" ]; then
    cp "$DIR/curl" /tmp/pf-curl 2>/dev/null && chmod 755 /tmp/pf-curl 2>/dev/null && CURL="/tmp/pf-curl"
fi
[ -z "$CURL" ] && command -v curl >/dev/null 2>&1 && CURL="curl"
if [ -z "$CURL" ]; then echo "no curl available"; exit 1; fi

# 複製 DB 到 /tmp 再上傳，避免上傳中裝置正在寫入、也不寫爆 onboard。
cp "$DB" /tmp/pf-upload.sqlite || exit 1

# LAN 走 http，不需要 TLS/憑證。密鑰放 header，接收端驗證。
"$CURL" -f -s -S \
    -H "X-PaperFolio-Token: $TOKEN" \
    --data-binary @/tmp/pf-upload.sqlite \
    "$URL"
RC=$?

rm -f /tmp/pf-upload.sqlite /tmp/pf-curl
exit $RC
