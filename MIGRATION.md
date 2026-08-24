# 前端搬遷 Vercel / 後端 JSON API 化 — 改法紀錄（lin-on-test）

本文件記錄 `lin-on-test`（「普平物管系統體驗區」）比照 [`lin-on`](../lin-on/MIGRATION.md) 的做法，把前端搬到 Vercel、後端留在 Apps Script 並改成 JSON API 的架構決策與實際改動。

## 跟 lin-on 的關係

`lin-on-test` 是用 `clasp clone` 抓下來的另一個 Apps Script 專案，跟 `lin-on` 是同一套系統分岔出來的兩支：
- `lin-on-test` 少了 `lin-on` 才有的轉移單正式寫回、`TransferRequests`/`StocktakeLog` 分頁、資產位置表 17 欄（`臨界值`、`位置移轉紀錄`）等功能，屬於較早/較簡化的一支。
- `lin-on-test` 多了 `lin-on` 沒有的 3 個檔案：`fridge.html`（冰箱式捐贈跑馬燈看板）、`nine-grid.html`（九宮格取貨定位看板）、`nine-api.js`（九宮格跨裝置同步用的後端 API，`setNineGridTarget`/`getNineGridTarget`）。

架構圖、密鑰設定方式、已知行為差異（`withFailureHandler` 省略時的行為、導覽列從 `?page=xxx` 改成 `xxx.html`）都跟 `lin-on` 完全一致，不重複寫，請參考 `lin-on/MIGRATION.md`。這裡只記錄跟 lin-on-test 有關、不一樣的部分。

## 日常開發流程：以後改東西該怎麼做

這個專案現在是「前端 Vercel（跟著 git push 自動部署）+ 後端 Apps Script（要手動 clasp push/deploy）」的混合架構，**兩條部署管道完全獨立、互不相關**——push 到 GitHub 不會讓 Apps Script 跟著更新，`clasp push` 也不會讓 Vercel 重新部署。改東西之前先分清楚自己改的是哪一邊。

### 情況 1：只改前端畫面（.html 的排版、文字、樣式，沒有新增呼叫後端的功能）

改完 `.html` → `git add` → `git commit` → `git push`。GitHub 接了 Vercel，push 上去會自動重新部署，不用碰 Apps Script。

### 情況 2：只改後端邏輯（.js 檔案本身的邏輯調整，沒有新增函式）

改完 `.js` 後，**兩步都要做**：

```
clasp push                          # 更新 Apps Script 的 HEAD 程式碼
clasp deploy -i <deploymentId>      # 把「正在使用中」的部署更新到新版本
```

`<deploymentId>` 用 `clasp deployments` 查。只做 `clasp push` 不做 `clasp deploy -i` 的話，前端打到的還是舊邏輯——部署是釘住版本號的快照，不會自動跟著 HEAD 更新。

### 情況 3：開發新功能（前端要呼叫一個全新的後端函式）——最容易漏步驟

1. 在對應的 `.js` 檔案裡寫新函式。如果是會寫入庫存/資料的操作，記得照現有的模式在函式最前面加 `rejectIfStocktakeLocked('操作名稱')` 檢查盤點鎖定（參考 `AssetOps.js` 裡 `importAssetFast`/`withdrawItem`/`returnAsset` 的寫法），並用 `LockService.getScriptLock()` 包住實際寫入，避免併發寫壞資料。
2. **把新函式名稱加進 `ApiRouter.js` 的 `API_WHITELIST`**——這一步最容易忘記。忘記加的話前端呼叫會拿到 `{"error":"不允許呼叫此函式：xxx"}`，不是「函式不存在」，是白名單故意擋下來的，很容易誤以為是別的地方壞掉在那邊除錯。
3. 在 `.html` 裡用 `google.script.run.withSuccessHandler(...).withFailureHandler(...).新函式(參數)` 呼叫（`gas-polyfill.js` 已經把這個語法透明轉發到 `/api/gas`，不用改呼叫方式）。
4. 部署：`.js` + `ApiRouter.js` 走情況 2（`clasp push` + `clasp deploy -i`）；`.html` 走情況 1（`git push`）。**兩邊都要各自部署**，缺一邊功能就是一半動一半不動。
5. 建議動手前先回頭看一下這份文件最上面「呼叫點盤點」那張表，改完之後也把新函式加進去，保持這份文件是白名單的即時對照表，下次要查「這個函式是哪個頁面在用、宣告在哪個檔案」才不會要重新盤點一次。

### 一般新功能開發的建議順序

1. 先想清楚這個功能純前端、純後端、還是兩邊都要動（大部分新功能都是情況 3）。
2. 後端先寫、先確認邏輯對（可以在 Apps Script 編輯器裡直接執行函式測試，不用等前端串好）。
3. 白名單別忘記加。
4. 前端串接，本機開 `.html` 直接用瀏覽器打開通常沒辦法測（`google.script.run`/`fetch('/api/gas')` 需要真的部署過的網址），所以前端邏輯寫完後直接照上面步驟 4 部署，再到 Vercel 給的網址上實測。
5. 兩邊都部署完，再回來補這份文件（呼叫點盤點表 + 白名單清單），避免文件跟實際程式碼兜不起來，下次要查就找不到。

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

- **`nine-grid.html` 的 `FIXED_CABINET_ORDER`（16 格固定陣列）裡有重複值**：目前是「B1-D10機動」出現兩次（第 2 格、第 13 格），導致 `ROOM_TO_SLOT` 對照表被後面的重複值覆蓋，第 2 格永遠不會被點亮（畫面上仍會顯示這張卡片，只是燈永遠亮不到它）。正確的格位名稱需要現場核對實體佈局才能確定，記錄下來但沒有動，需要請熟悉現場佈局的人確認後修正。
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

## 排錯記錄：`nine-grid.html` 品名不同步（2026-08-24）

現象：`withdraw.html` 查詢新物品後，`nine-grid.html` 的燈號位置（`loc`）會正確更新，但畫面上「目前物品」欄位的品名卡在上一次查詢的值不換，且不穩定重現（有時對、有時不對）。

### 排查過程中，這些方向都測過但不是根因

- **TTL 太短（15 秒）**：一開始懷疑「秒熄燈」是因為 `TARGET_TTL_MS` 只有 15 秒，跟實際操作節奏（選物品→切分頁→看畫面）對不上，容易一看就已經過期。這個問題**確實存在**，也確實修了（15s → 60s → 最後 300s → 使用者要求改回 180s），但只解決了「燈太快熄」，不是「品名不同步」的根因。
- **後端 `nine-api.js` 沒部署成功**：一度懷疑 `setNineGridTarget`/`getNineGridTarget` 根本沒 `clasp deploy`。用 `curl` 直接打 `/api/gas` 驗證過，後端其實有正常運作，排除。
- **中文編碼被吃掉**：用 `curl`/Node 手動測 API 時看到中文變成 `U+FFFD` 亂碼，一度懷疑是後端編碼問題。後來確認這只是我自己測試工具（Windows 終端機）送出請求時的編碼問題，真實瀏覽器送出的請求完全正常，排除。
- **選錯物品 / IME 打字中途誤觸發**：懷疑搜尋框打字過程中可能選到錯的品項。後來用 console log 直接印出 `showInfo()` 解析到的 `item` 物件，證實每次選擇解析出來的品項都是對的——**寫入端從頭到尾都是對的**，問題不在這裡。

### 真正的根因

`nine-grid.html` 原本把 `位置`、`更新時間`、`品名` 存成**三個獨立的 `localStorage` key**（`nineGridTargetLoc`/`nineGridTargetLocAt`/`nineGridTargetItem`）。這三個 key 要嘛一起讀、要嘛一起寫，但寫入是三次分開的 `setItem()` 呼叫，不是一個原子操作。

排錯過程中反覆重新整理、多次在不同視窗開 `nine-grid.html` 做測試，導致**同時有不只一個分頁在跑 1.2 秒一次的輪詢**，每個分頁都有自己獨立的 `renderBoard()`/`pullTargetFromServer()` 執行緒。分頁之間對同一組 `localStorage` key 沒有任何互斥機制，於是出現這種時序：分頁 A 剛寫完「新位置」，這時分頁 B 的輪詢跑到，讀到「新位置 + 舊品名」這種寫到一半的組合，然後**把這個不一致的組合又寫回去**，等於把錯誤狀態鎖住。單一分頁測試時很難重現，一旦背景留著別的分頁就會不穩定出現。

### 修法

把三個 key 合併成一個：`nineGridTarget`，內容是 JSON `{ loc, item, ts }`。任何一次讀取或寫入都變成單一個 `getItem`/`setItem`，不可能再讀到「寫一半」的中間狀態。`withdraw.html`（寫入端）跟 `nine-grid.html`（讀取端、輪詢回寫）都要一起改，缺一邊會兩邊格式對不上。

同時追加了一個獨立但相關的強化：`nine-grid.html` 加了 `visibilitychange` 監聽，分頁從背景切回前景時立刻強制 `renderBoard()` + `pullTargetFromServer()`，不用等瀏覽器把降頻的 `setInterval` 追上來——背景分頁計時器被瀏覽器降頻，是這類「切分頁回來資料是舊的」問題的常見成因，之後遇到類似狀況可以優先往這個方向排查。

### 這次debug 方法上學到的事

**光看程式碼邏輯推理，在多分頁/多裝置同步的場景下很容易卡住**——程式碼單獨看都對，問題只在特定時序下才會出現。真正定案靠的是在寫入端（`showInfo()`/`publishNineGridTarget()`）跟讀取端（`renderBoard()`/`pullTargetFromServer()`）**都加上 `console.log`，直接印出每一步的實際數值**，一步步用瀏覽器 Console 的真實輸出取代猜測。之後遇到「邏輯看起來沒問題但行為對不上」的狀況，可以優先考慮：(1) 是不是有多個分頁/裝置在同時寫同一份共享狀態；(2) 對多個相關欄位的寫入，是不是應該合併成一個原子操作，而不是分開寫。
