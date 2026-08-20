# 前端搬遷 Vercel / 後端 JSON API 化 — 改法紀錄（lin-on-test）

本文件記錄 `lin-on-test`（「普平物管系統體驗區」）比照 [`lin-on`](../lin-on/MIGRATION.md) 的做法，把前端搬到 Vercel、後端留在 Apps Script 並改成 JSON API 的架構決策與實際改動。

## 跟 lin-on 的關係

`lin-on-test` 是用 `clasp clone` 抓下來的另一個 Apps Script 專案，跟 `lin-on` 是同一套系統分岔出來的兩支：
- `lin-on-test` 少了 `lin-on` 才有的轉移單正式寫回、`TransferRequests`/`StocktakeLog` 分頁、資產位置表 17 欄（`臨界值`、`位置移轉紀錄`）等功能，屬於較早/較簡化的一支。
- `lin-on-test` 多了 `lin-on` 沒有的 3 個檔案：`fridge.html`（冰箱式捐贈跑馬燈看板）、`nine-grid.html`（九宮格取貨定位看板）、`nine-api.js`（九宮格跨裝置同步用的後端 API，`setNineGridTarget`/`getNineGridTarget`）。

架構圖、密鑰設定方式、已知行為差異（`withFailureHandler` 省略時的行為、導覽列從 `?page=xxx` 改成 `xxx.html`）都跟 `lin-on` 完全一致，不重複寫，請參考 `lin-on/MIGRATION.md`。這裡只記錄跟 lin-on-test 有關、不一樣的部分。

## 呼叫點盤點（11 個 html、50 處呼叫）

比 lin-on 多 2 個頁面（`fridge.html`、`nine-grid.html`），白名單也因此比 lin-on 的 31 個多 2 個（`getFridgeFeed`、`getNineGridTarget`）：

| 函式 | 呼叫的頁面 |
|---|---|
| getLocationList | asset_entry.html |
| searchAssetForRestock | asset_entry.html |
| importAssetFast | asset_entry.html |
| updateAssetPhotoInBackground | asset_entry.html |
| getLocationData | asset_return.html, withdraw.html, nine-grid.html |
| getBorrowedAssets | asset_return.html, withdraw.html |
| returnAsset | asset_return.html |
| getWithdrawInventory | asset_return.html, withdraw.html |
| getFridgeFeed | fridge.html |
| warmUpSummaryCache | index.html |
| updatePhotoInBackground | index.html |
| addDonationFast | index.html |
| getScrapDetails | inventory.html |
| syncRulesFromSheet | inventory.html |
| syncAssetSheetLocationsAndCaches | inventory.html（透過共用 runner 變數，特徵偵測後擇一呼叫） |
| hardRefreshAllCachesAndIndexes | inventory.html（同上，另一擇一分支） |
| getDataVersion | inventory.html, withdraw.html（含輪詢） |
| getInventoryDetails | inventory.html |
| getRecentActivity | inventory.html |
| getAssetsDetails | inventory.html |
| exportInventoryToHtml | inventory.html |
| exportTransactionHistoryByRange | inventory.html |
| getNearExpiryLite | near-expiry.html |
| getNineGridTarget | nine-grid.html（1.2 秒輪詢一次，跨裝置同步用） |
| getRecentDonationsLite | recent.html |
| getInventoryCorrectionData | stocktake-correction.html |
| setStocktakeLock | stocktake-correction.html |
| applyStocktakeCorrections | stocktake-correction.html |
| searchTransferCandidates | transfer.html |
| getTransferLocationList | transfer.html |
| setNineGridTarget | withdraw.html |
| getWithdrawAssets | withdraw.html |

用 3 個背景 agent 交叉比對過：11 個 html 檔案裡的每一處 `google.script.run` 呼叫都對應得到白名單裡的函式，32 個白名單函式在後端 .js 裡也都有對應宣告，沒有遺漏也沒有多餘項目（含兩個非 ASCII 檔名的後端檔案 `分頁控制台.gs.js`、`未命名.js`，確認沒有被搜尋工具誤判跳過）。

`transfer.html` 目前只有查詢/帶入表單流程，**沒有**實際送出移轉的 `executeAssetTransfer`（源碼裡明確寫著「這一版先把查詢與表單流程接起來，後續再串正式寫回」）——這是刻意分階段開發，不是搬遷漏掉，白名單裡因此也沒有這個函式。

## 新增 / 修改的檔案

跟 lin-on 完全相同的模式：新增 `ApiRouter.js`（32 函式白名單）、`gas-polyfill.js`、`api/gas.js`、`.claspignore`、`.vercelignore`（額外排除 `nine-api.js`、`分頁控制台.gs.js`、`未命名.js` 這三個 lin-on 沒有的後端檔案）、`.gitignore`、`package.json`；11 個 html 都加入 `<script src="./gas-polyfill.js">`；9 個有導覽列的頁面（`fridge.html`、`nine-grid.html` 是獨立看板頁，沒有導覽列，不用改）導覽列改成相對檔名連結。`nine-grid.html` 的 1.2 秒跨裝置輪詢（`pullTargetFromServer`）遷移後會透過 `/api/gas` 打 HTTP 請求，`gas-polyfill.js` 透明處理，不需要額外改法，但輪詢延遲/負載會比原本 Apps Script 內部直呼叫略高，如果之後覺得太頻繁可以考慮拉長輪詢間隔。

## 順便修的 Bug

跟這次搬遷無關、但檢查後端邏輯時發現的既有問題，一併修掉：

1. **`Expiry.js` `handleExpiryAction()` 漏了盤點鎖定檢查**：專案裡所有其他會寫入庫存的入口（`AppRouter.js` 捐贈入庫、`AssetOps.js` 入庫/借用/歸還）都會用 `rejectIfStocktakeLocked(...)` 擋下盤點鎖定期間的寫入，唯獨到期提醒 Email 裡的「標記已領用」一鍵連結沒有這道檢查——代表盤點鎖定期間點開舊信仍能把庫存歸零、寫入交易紀錄，跟盤點凍結的數字對不起來。已補上跟其他寫入點一致的檢查。
2. **`nine-grid.html` 讀取位置資料失敗後畫面永久卡死**：原本失敗只顯示錯誤訊息，兩個輪詢（畫面重繪、跨裝置同步）都只在成功回呼裡才啟動，失敗一次就再也不會自動恢復。已改成失敗後 5 秒自動重試。

## 尚未處理、需要人工確認的問題

- **`nine-grid.html` 的 `FIXED_CABINET_ORDER`（16 格固定陣列）裡有重複值**：「1F-B17照客」跟「3F-A15心燈」各出現兩次，導致 `ROOM_TO_SLOT` 對照表被後面的重複值覆蓋，其中一格永遠不會被點亮。正確的第 16 格房名需要現場核對實體佈局才能確定，這次沒有動，需要請熟悉現場佈局的人確認後修正。
- **`Expiry.js` 的「標記報廢」連結沒有對應處理分支**：到期提醒信裡的 `act=discard` 連結點下去會落到「未知操作類型」，`lin-on`、`lin-on-test` 都有這個問題，不是這次分岔造成的，也不在這次搬遷範圍內，記錄下來供之後決定要補上「報廢」的實際處理邏輯還是乾脆拿掉這個連結。
- **`lin-on`（不是 lin-on-test）的白名單漏了 `syncRulesFromSheet`**：`lin-on` 的 `inventory.html` 也有呼叫這個函式，但 `lin-on/ApiRouter.js` 的白名單沒放，在 `lin-on` 現在的 Vercel 版本上這個功能會靜默失敗（回傳「不允許呼叫此函式」）。這是另一個專案的既有問題，這裡只是順帶發現，需要另外去補 `lin-on/ApiRouter.js` 的白名單。

## 驗證清單

**已經做過、不需要真的部署就能確認的：**
- ✅ 32 個白名單函式，跟 11 個 html 實際呼叫的函式做過雙向交叉比對，互相對應、沒有遺漏
- ✅ 32 個白名單函式，每一個在 `.js` 後端檔案裡都有對應的 `function` 宣告
- ✅ `api/gas.js` 用 Node 搭配假的 `fetch` 做過測試：環境變數缺失會回 500、正常請求會正確帶密鑰轉發並設定 `redirect: 'follow'`、非 POST 方法回 405、缺 `fn` 參數回 400
- ✅ 11 個 html 檔案都確認加上 `<script src="./gas-polyfill.js">`；9 個導覽列頁面確認不再有任何 `getScriptUrl` 呼叫

**需要實際部署後才能做的（沒有 Apps Script / Vercel 帳號權限，無法代勞）：**
1. `clasp push` 把 `ApiRouter.js`、修過的 `Expiry.js` 部署上去，並在 Script Properties 設定 `API_SECRET`，取得 Web App exec URL
2. 在 Vercel 專案設定 `GAS_EXEC_URL`、`API_SECRET` 環境變數（或本機 `vercel dev` + `.env.local`）
3. 實際點過 11 個頁面的每一個功能，特別是 `nine-grid.html` 的跨裝置輪詢在 HTTP 代理下的實際延遲感受，以及盤點鎖定期間點開到期提醒信確認 Bug 1 真的被擋下來
4. 跨平台檢查：桌機 Chrome/Edge/Safari、手機 Chrome(Android)/Safari(iOS)、LINE App 內建瀏覽器
5. 部署完成、有測試網址後，可以請我用 `curl` 幫忙驗證 `/api/gas` 的白名單阻擋、密鑰驗證等後端行為是否符合預期

## Step 3：git repo + Vercel 部署

### 已完成
- 本機 `git init`，建立第一個 commit，內容是這次搬遷的全部改動

### 接下來需要使用者操作的部分（比照 lin-on 的流程，見 `lin-on/MIGRATION.md` 的對應章節）
1. 到 GitHub 建立一個新的**空** repository
2. 把新 repo 網址告訴我，或自行執行 `git remote add origin ... && git push -u origin master`
3. 到 [vercel.com](https://vercel.com) 用同一組 GitHub 帳號登入，Add New Project → 選這個 repo → Framework Preset 選「Other」
4. 在 Vercel 專案的 Environment Variables 設定 `GAS_EXEC_URL`、`API_SECRET`
5. Deploy，拿到 Vercel 給的網址後即可實際測試

## 踩過的雷與注意事項

跟 `lin-on/MIGRATION.md` 記錄的完全一樣（`clasp push` 會把整個資料夾當成 GAS 專案推上去、改 `.claspignore` 後要故意動一行才會觸發完整推送、部署要記得 `clasp deploy -i <id>` 而不是只 `clasp push`、剛部署完可能有邊緣快取延遲、測試 `doPost` 不要用 `curl --post302` 硬保留 POST、GAS 本來就會自動加 CORS 標頭、盤點呼叫點要用兩種搜尋方式交叉比對），這次沒有踩到新的雷，不重複列。
