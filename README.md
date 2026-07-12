# PaperFolio for Kobo

把 Kobo 上的畫線，乾淨地同步進 Obsidian —— 一本書一則筆記，依真實閱讀順序排列、依章節分組，而且保護你自己手寫的心得。

> 桌面版 Obsidian 專用（`isDesktopOnly`）。無線同步規劃在後續版本，目前為 USB 版。

## 特色

- **一本書一則筆記**：畫線包成一則乾淨的 `.md`，附 frontmatter。
- **真實閱讀順序**：不是用「畫線時間」排（那會讓回頭補的畫線跑到後面），而是用書內位置精準排序。
- **真章節名分組**：章節標題直接來自 Kobo 的目錄資料，不是內部檔名。
- **保護手寫心得**：自動內容包在哨兵區塊裡，重新同步只重寫區塊內，你在區塊外寫的總結永遠不動。
- **增量去重**：重複同步只算新增／變更，不會重複洗版。
- **索引 MOC**：自動產生一則索引，依畫線數列出所有書、可點進去。
- **只讀不寫回**：只把 `KoboReader.sqlite` 讀進記憶體解析，永不修改你的 Kobo。

## 使用方式

1. 用 USB 把 Kobo 插上電腦，等它掛載。
2. 在 Obsidian 點左側 PaperFolio 圖示，或用命令面板執行「同步 Kobo 畫線到 Obsidian」。
3. 畫線會寫進設定裡的輸出資料夾（預設 `PaperFolio/`）。

若你的 Kobo 掛載路徑不是預設值，可在外掛設定裡指定 `KoboReader.sqlite` 的完整路徑。

## 設定

- Kobo 資料庫路徑（留空用預設掛載路徑）
- 輸出資料夾
- 匯入門檻（低於此畫線數的零星書不匯入）
- 畫線風格：Callout / 引用區塊 / 條列
- 依章節分組、顯示日期、顏色轉標籤、檔名格式
- 是否匯入折頁（預設關；折頁只記位置）

## 開發

```bash
npm install
npm run dev     # 監看模式，輸出 main.js
npm run build   # 型別檢查 + 正式打包
```

把 `main.js`、`manifest.json`、`styles.css` 放進你 vault 的 `.obsidian/plugins/paperfolio-kobo/`，重載 Obsidian 即可測試。

## 授權

MIT。sqlite 解析使用 [sql.js](https://github.com/sql-js/sql.js)（MIT）。
