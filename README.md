# AI 跨來源知識整合學習系統

本專案包含純 HTML、CSS、JavaScript 前端，以及 Node.js、Express、Supabase PostgreSQL、Gemini API 後端。步驟 1～4 與歷史學習紀錄皆已串接後端；`localStorage` 僅作為畫面切換時的暫存與斷線備援。

## 後端技術

- JavaScript（Node.js 20 以上）
- Express 5
- PostgreSQL
- Google GenAI SDK：`@google/genai`
- Gemini 模型：`gemini-3.1-flash-lite`

## 後端開發設定

1. 建立 Supabase 專案，取得 PostgreSQL 連線字串。
2. 將 `.env.example` 複製成 `.env`。
3. 填入 `DATABASE_URL` 與 `GEMINI_API_KEY`；`.env` 不可提交到 GitHub。
4. 安裝套件：`npm ci`
5. 建立資料表：`npm run db:migrate`
6. 啟動後端：`npm run dev`
7. 開啟 `http://localhost:3000/api/health` 檢查資料庫與 Gemini 設定。

目前已建立的 API：

- `GET /api/health`
- `GET /api/records`
- `POST /api/records`
- `GET /api/records/:recordId/materials`
- `POST /api/records/:recordId/materials/text`
- `POST /api/records/:recordId/materials/pdf`（欄位名稱為 `pdf`）
- `GET /api/records/:id`
- `PATCH /api/records/:id`
- `DELETE /api/records/:id`
- `GET /api/records/:recordId/messages`
- `POST /api/records/:recordId/messages`
- `GET /api/records/:recordId/viewpoints`
- `POST /api/records/:recordId/viewpoints/generate`
- `PATCH /api/records/:recordId/viewpoints/:viewpointId`
- `POST /api/records/:recordId/viewpoints/:viewpointId/confirm`
- `GET /api/records/:recordId/viewpoint-revisions`
- `POST /api/records/:recordId/viewpoint-revisions`
- `GET /api/records/:recordId/knowledge/related`
- `GET /api/records/:recordId/knowledge/links`
- `GET /api/records/:recordId/integrations`
- `POST /api/records/:recordId/integrations`
- `GET|POST /api/records/:recordId/integrations/:integrationId/discussion`
- `POST /api/records/:recordId/integrations/:integrationId/generate`
- `GET|POST /api/records/:recordId/integrations/:integrationId/revisions`
- `PATCH /api/records/:recordId/integrations/:integrationId`
- `POST /api/records/:recordId/integrations/:integrationId/confirm`

## 開啟方式

1. 用 VS Code 開啟本資料夾。
2. 執行 `npm run dev` 啟動後端，再在 VS Code 使用 Live Server 開啟 `index.html`。
3. 建議使用 Chrome、Edge 或 Firefox 的較新版本。

## 三個頁面

- `index.html`：步驟 1，由學習者輸入學習標題並上傳材料。頁面固定在單一視窗高度且不產生整頁捲動；開始學習後標題與材料鎖定為唯讀。
- `dialogue.html`：步驟 2，學習者與 Gemini AI 對話。頁面固定在單一視窗高度且不產生整頁捲動；只有對話紀錄區可以獨立捲動。
- `viewpoint.html`：步驟 3，系統彙整觀點；「修改」、「修改助手」與「確認觀點」並排顯示。「修改」只開放文字編輯；必須按「修改助手」才顯示下方可獨立捲動的助手視窗，整頁本身不捲動。

觀點一旦確認，步驟 3 會鎖定為唯讀。若要重新修改，必須先回步驟 2 新增至少一則學習者對話，再按「AI 整理觀點」產生新版觀點；此時舊的知識連結與整合草稿會失效並重新計算。
- `knowledge-links.html`：步驟 4。呈現新舊觀點、相關內容、Gemini 引導問題、學習者比較，以及可修改與確認的跨來源整合觀點。只有資料庫中存在其他已確認觀點時才會進入；無可比較資料時，確認觀點後直接前往資料庫。

步驟 4 的左右比較卡固定等高。後端以 PostgreSQL 文字相似度找出相關的已確認觀點；比較與追問區採用與步驟 2 相同的聊天介面。學習者第一次回答後，Gemini 會進一步追問；再次回覆後才整理融合想法。整合結果提供「修改」、「修改助手」與「確認整合」三個按鈕，只有按下「修改助手」才顯示下方助手視窗。確認後會在 PostgreSQL 建立兩筆知識來源的關係。

跨來源知識採累積式保存：例如 001 與 002 的整合結果會儲存在 002；日後 005 出現相關想法時，系統會優先比對並擷取 002 的已確認整合觀點，而不是重新拼接 001 與 002 的原始觀點。005 完成後，新一輪整合結果則儲存在 005。
- `integration.html`：比較不同日期的新舊觀點、回答引導問題、建立連結、整理與確認。
- `database.html`：搜尋並查看歷史學習紀錄、原始材料、對話、觀點與整合紀錄。

資料庫頁不顯示頁首日期與時間；每筆紀錄卡的標籤直接顯示建立日期與時間，Record detail 不重複顯示日期、時間或附件檔名。首頁頁首只顯示日期與時間，不顯示瀏覽器儲存提示文字。

左上三條線前往資料庫；右上房子回到學習首頁。所有頁面都可垂直捲動，並支援手機版面。

右上房子會回到重置後的新學習首頁；它只清除目前選取中的工作狀態，不會刪除歷史資料。資料庫可查看或刪除每一筆紀錄；「進行中」與「尚未完成整合」可以編輯，其中後者會直接回到知識連結頁繼續完成整合。只有「已完成整合」與「觀點已保存」不開放編輯。狀態分為已完成整合、觀點已保存、尚未完成整合與進行中；已確認觀點但沒有跨來源資料可整合時，會歸類為「觀點已保存」。

資料庫的「查看」會在該筆紀錄正下方，以分離且對齊的白色卡片展開 Record detail，按鈕同時變為「收起」；再次點擊會關閉詳細內容。展開中的主題卡維持白底，並以柔和的黃色邊緣光暈標示。

按下「查看／收起」時會以當下的捲動位置為準鎖定視野，停用瀏覽器自動捲動錨定，並在內容高度縮短時暫時保留足夠的頁面高度，避免畫面因展開或收合而跳動；這不會回到先前按下「查看」的位置。

## 建議體驗流程

1. 首次開啟時會建立一筆示範舊紀錄，方便立即測試跨來源功能。
2. 在首頁貼上新的學習文字並按「開始學習」。
3. 回答至少一個問題，按「AI 整理觀點」，修改後確認。
4. 出現相關知識提示後，前往知識整合頁。
5. 回答比較問題、選擇關係、寫下連結說明並確認保存。
6. 從左上選單進入資料庫查看完整紀錄。

## 資料與 AI 說明

- 瀏覽器只呼叫本專案的 Express API；Gemini 金鑰只存在後端 `.env`，不會傳到前端。
- Gemini 使用 `gemini-3.1-flash-lite`，負責學習追問、觀點整理、修改助手與跨來源整合。
- PDF 由後端擷取文字並存入資料庫；原始上傳檔案放在本機 `uploads/`，不提交到 GitHub。
- 學習資料主要儲存在 Supabase PostgreSQL，因此可由不同裝置連線到同一套後端後查看。
- `.env`、API 金鑰、資料庫密碼、`node_modules/` 與上傳檔案都已排除在 Git 版本控制之外。

## 檔案結構

```text
ai-knowledge-learning-system/
├─ server/
│  ├─ migrations/
│  └─ src/
├─ uploads/
├─ package.json
├─ .env.example
├─ index.html
├─ dialogue.html
├─ viewpoint.html
├─ knowledge-links.html
├─ integration.html
├─ database.html
├─ styles.css
├─ app.js
└─ README.md
```
