# Kobo 一鍵無線同步 — 安裝步驟（LAN 版）

架構：Kobo 一鍵 → 同一個 WiFi → 你 Mac 上的 PaperFolio 外掛接收端 → Obsidian。
資料只在你家用網路內流動，不經任何第三方伺服器。同步當下 Mac 上 Obsidian 要開著。

前提：Mac 與 Kobo 連同一個 WiFi。

---

## 一、Mac 端（Obsidian 外掛）

1. 在 Obsidian 開啟 PaperFolio 外掛。
2. 設定 → PaperFolio → 「無線接收（區網）」→ 打開**啟用無線接收**。
   - 首次啟用 macOS 會問「是否允許接受連線」，點**允許**。
3. 記下設定頁顯示的：
   - **你的同步位址**（形如 `http://192.168.1.108:8322/sync`）
   - **接收密鑰**

> 埠預設 8321；若被占用可改（例 8322），同步位址會跟著更新。

---

## 二、Kobo 端（一次性安裝，Kobo 插上電腦時做）

1. 安裝 **NickelMenu**（Kobo 社群外掛）：把 NickelMenu 的 `KoboRoot.tgz` 放進 Kobo 的 `.kobo/`，安全退出後 Kobo 會自動安裝並重開。
2. 在 Kobo 建立資料夾 `/.adds/folio/`，放入：
   - `send-highlights.sh`（本資料夾提供）
   - `curl`（靜態 ARM 可執行檔；若 Kobo 韌體已內建 curl 可省略——腳本會自動退回系統 curl）
3. 編輯 `send-highlights.sh`，把 `URL` 與 `TOKEN` 兩行填成步驟一記下的同步位址與密鑰。
4. 把 `nm_paperfolio` 複製到 Kobo 的 `/.adds/nm/paperfolio`。
5. 安全退出 Kobo。主畫面與閱讀中的選單會多一顆「PaperFolio 同步畫線」。

---

## 三、日常使用

讀完 → 主畫面或書內點「PaperFolio 同步畫線」→ 自動連 WiFi → 畫線送到 Mac → Obsidian 更新。
（Obsidian 會跳通知「PaperFolio（無線）：已匯入 N 條畫線」。）

---

## 疑難排解

- **點了沒反應 / 電腦沒收到**：確認 Mac 與 Kobo 同一個 WiFi；確認 Obsidian 開著且「無線接收」為開。
- **IP 變了**：家用 WiFi 若用 DHCP，Mac 的 LAN IP 可能變動，導致 `URL` 失效。到外掛設定頁看新的同步位址，重新填進 `send-highlights.sh` 即可；或在路由器把 Mac 設成固定 IP 一勞永逸。
- **macOS 沒跳允許連線**：到「系統設定 → 網路 → 防火牆」確認未封鎖 Obsidian。
- **檔案在 Mac 上編輯後**：macOS 可能留下 `._*` 隱藏檔，NickelMenu 會誤讀；在 Mac 終端機對 Kobo 跑 `dot_clean /Volumes/KOBOeReader` 清掉。
