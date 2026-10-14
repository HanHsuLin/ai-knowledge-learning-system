(function () {
  "use strict";
  const STORAGE_KEY = "aiki_mvp_records_v1";
  const ACTIVE_KEY = "aiki_mvp_active_v1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function loadRecords() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch (_) { return []; } }
  function saveRecords(records) { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
  function activeId() { return localStorage.getItem(ACTIVE_KEY); }
  function setActive(id) { localStorage.setItem(ACTIVE_KEY, id); }
  function getActive() { return loadRecords().find((item) => item.id === activeId()) || null; }
  function stageOf(record) {
    if (!record) return 1;
    if (record.stage) return record.stage;
    if (record.confirmed) return 4;
    if (record.viewpoint) return 3;
    return 2;
  }
  function updateRecord(id, patch) {
    const records = loadRecords(), index = records.findIndex((item) => item.id === id);
    if (index < 0) return null;
    records[index] = { ...records[index], ...patch, updatedAt: new Date().toISOString() };
    saveRecords(records); return records[index];
  }
  function formatDate(value, includeTime = true) {
    const date = new Date(value); if (Number.isNaN(date.getTime())) return value || "—";
    return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", ...(includeTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}) }).format(date);
  }
  function escapeHTML(value = "") { return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]); }
  function summarize(text) {
    const clean = text.replace(/\s+/g, " ").trim();
    const parts = clean.split(/[。！？!?；;\n]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return "尚未形成觀點摘要。";
    return `我目前的理解是：${parts.slice(0, 3).join("；")}。這些內容之間的關係，仍需要回到材料中的證據進一步確認。`;
  }

  function comparisonTerms(text) {
    const normalized = String(text || "").toLowerCase();
    const terms = new Set((normalized.match(/[a-z0-9]{3,}/g) || []));
    const ignored = new Set(["目前", "理解", "這些", "內容", "之間", "需要", "進一", "一步", "確認", "材料", "觀點"]);
    const chineseGroups = normalized.match(/[\u3400-\u9fff]+/g) || [];
    chineseGroups.forEach((group) => {
      for (let index = 0; index < group.length - 1; index += 1) {
        const term = group.slice(index, index + 2);
        if (!ignored.has(term)) terms.add(term);
      }
    });
    return [...terms];
  }

  function consolidatedKnowledge(record) {
    if (record?.integration?.status === "confirmed" && record.integration.text) return record.integration.text;
    return record?.viewpoint || "";
  }

  function knowledgeRelevance(firstText, secondText) {
    const firstTerms = new Set(comparisonTerms(firstText));
    return comparisonTerms(secondText).reduce((score, term) => score + (firstTerms.has(term) ? 1 : 0), 0);
  }

  function extractRelevantSnippet(sourceRecord, comparisonText) {
    const learnerDialogue = (sourceRecord.conversation || [])
      .filter((message) => message.role === "user")
      .map((message) => message.text)
      .join("。");
    const integratedKnowledge = sourceRecord.integration?.status === "confirmed" && sourceRecord.integration.text
      ? sourceRecord.integration.text
      : "";
    const sourceText = integratedKnowledge || [sourceRecord.rawText, learnerDialogue, sourceRecord.viewpoint]
      .filter(Boolean)
      .join("。");
    const sentences = (sourceText.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [])
      .map((sentence) => sentence.trim())
      .filter((sentence, index, all) => sentence.length > 4 && all.indexOf(sentence) === index);
    const terms = comparisonTerms(comparisonText);
    const ranked = sentences
      .map((sentence, index) => ({
        sentence,
        index,
        score: terms.reduce((total, term) => total + (sentence.toLowerCase().includes(term) ? 1 : 0), 0)
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const selected = ranked.filter((item) => item.score > 0).slice(0, 2);
    const fallback = selected.length ? selected : ranked.slice(0, 2);
    const snippet = fallback.map((item) => item.sentence).join(" ").trim();
    if (!snippet) return "此紀錄目前沒有可擷取的相關文字。";
    return snippet.length > 280 ? `${snippet.slice(0, 280)}…` : snippet;
  }
  function titleFrom(text, fileName) { const clean = text.replace(/\s+/g, " ").trim(); return (clean.slice(0, 24) || fileName || "未命名學習紀錄") + (clean.length > 24 ? "…" : ""); }
  function toast(message) {
    $(".toast")?.remove(); const node = document.createElement("div"); node.className = "toast"; node.textContent = message;
    document.body.appendChild(node); setTimeout(() => node.remove(), 2500);
  }
  function setClock() {
    const now = new Date();
    if ($("#today")) $("#today").textContent = formatDate(now, false);
    if ($("#now-time")) $("#now-time").textContent = now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function initStepNav(current) {
    const unlocked = stageOf(getActive());
    $$(".step-link").forEach((link) => {
      const step = Number(link.dataset.step), locked = step > unlocked;
      link.classList.toggle("locked", locked); link.classList.toggle("current", step === current);
      link.setAttribute("aria-current", step === current ? "step" : "false"); link.setAttribute("aria-disabled", String(locked));
      if (locked) link.addEventListener("click", (event) => { event.preventDefault(); toast(`請先完成步驟 ${step - 1}`); });
    });
  }
  function requireStage(required) {
    const record = getActive();
    if (!record || stageOf(record) < required) { location.replace("index.html"); return null; }
    return record;
  }
  function renderMessages(target, messages, aiLabel = "模擬 AI 引導") {
    target.innerHTML = messages.map((message) => `<div class="message ${message.role === "user" ? "user" : "ai"}"><small>${message.role === "user" ? "我的想法" : aiLabel}</small>${escapeHTML(message.text)}</div>`).join("");
  }

  function initUpload() {
    initStepNav(1); let record = getActive();
    const titleInput = $("#learning-title"), input = $("#learning-text"), fileInput = $("#learning-file"), fileName = $("#file-name");
    if (record && stageOf(record) >= 2) {
      $("#upload-form").classList.add("hidden"); $("#locked-material").classList.remove("hidden");
      $("#locked-title").textContent = record.title; $("#locked-file").textContent = record.fileName || "無附件"; $("#locked-text").textContent = record.rawText;
    }
    fileInput.addEventListener("change", () => { fileName.textContent = fileInput.files[0] ? fileInput.files[0].name : "尚未選擇檔案"; });
    $("#start-learning").addEventListener("click", () => {
      const title = titleInput.value.trim(), text = input.value.trim(), file = fileInput.files[0];
      if (!title) { toast("請先輸入學習標題"); titleInput.focus(); return; }
      if (!text && !file) { toast("請先輸入學習文字或選擇 PDF 檔案"); return; }
      const now = new Date().toISOString();
      record = { id: `rec-${Date.now()}`, createdAt: now, updatedAt: now, stage: 2, title, fileName: file?.name || "無附件", rawText: text || `已選擇檔案「${file.name}」。純前端 MVP 不會讀取 PDF 內容。`, conversation: [{ role: "ai", text: "你認為這份材料最重要的主張是什麼？請先用自己的話說明。" }], viewpoint: "", confirmed: false, related: [], integration: null };
      const records = loadRecords(); records.unshift(record); saveRecords(records); setActive(record.id); location.href = "dialogue.html";
    });
    $("#new-learning")?.addEventListener("click", () => { localStorage.removeItem(ACTIVE_KEY); location.reload(); });
  }

  function initDialogue() {
    const record = requireStage(2); if (!record) return; initStepNav(2);
    const confirmationBaseline = record.confirmed
      ? (record.confirmedConversationCount ?? (record.conversation || []).length)
      : 0;
    $("#session-title").textContent = record.title; $("#session-source").textContent = `${record.fileName} · 建立於 ${formatDate(record.createdAt)}`;
    renderMessages($("#chat-log"), record.conversation || []);
    $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
    function sendMessage() {
      const input = $("#chat-input"), value = input.value.trim(); if (!value) return;
      const conversation = [...(getActive().conversation || []), { role: "user", text: value }];
      const replies = ["你用了材料中的哪些內容支持這個判斷？是否存在相反的例子？", "如果要把這個想法說給沒讀過材料的人，你會如何補充其中的因果關係？", "請比較其中兩個概念：它們是互補、因果，還是彼此矛盾？"];
      const count = conversation.filter((m) => m.role === "user").length;
      conversation.push({ role: "ai", text: replies[(count - 1) % replies.length] }); updateRecord(record.id, { conversation }); input.value = "";
      renderMessages($("#chat-log"), conversation);
      $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
      $("#make-summary").disabled = record.confirmed && conversation.length <= confirmationBaseline;
    }
    $("#send-message").addEventListener("click", sendMessage);
    $("#chat-input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
    $("#make-summary").disabled = record.confirmed
      ? (record.conversation || []).length <= confirmationBaseline
      : !(record.conversation || []).some((m) => m.role === "user");
    $("#make-summary").addEventListener("click", () => {
      const latest = getActive();
      if (latest.confirmed && (latest.conversation || []).length <= confirmationBaseline) {
        toast("請先新增一則對話，再重新整理觀點");
        return;
      }
      const ideas = latest.conversation.filter((m) => m.role === "user").map((m) => m.text).join("。") || latest.rawText;
      updateRecord(record.id, {
        viewpoint: summarize(ideas),
        confirmed: false,
        related: [],
        integration: null,
        knowledgeLinksSkipped: false,
        stage: 3
      });
      location.href = "viewpoint.html";
    });
  }

  function initViewpoint() {
    let record = requireStage(3); if (!record) return; initStepNav(3);
    const editor = $("#viewpoint-editor"); editor.value = record.viewpoint; editor.readOnly = true;
    const isLocked = record.confirmed === true;
    if (isLocked) {
      $("#edit-summary").disabled = true;
      $("#open-revision-assistant").disabled = true;
      $("#confirm-summary").disabled = true;
      $("#viewpoint-instruction").textContent = "此觀點已確認，目前僅供查看。";
    }
    $("#edit-summary").addEventListener("click", () => {
      if (isLocked) return;
      editor.readOnly = false; editor.focus();
      toast("已開放觀點文字編輯");
    });
    $("#open-revision-assistant").addEventListener("click", () => {
      if (isLocked) return;
      $("#revision-assistant").classList.remove("hidden");
      $("#open-revision-assistant").setAttribute("aria-expanded", "true");
      scrollRevisionToLatest();
      $("#revision-input").focus();
    });
    const revisionMessages = [{ role: "ai", text: "修改前先想想：這段摘要是否真的是你的理解？請先告訴我你想修改或補強哪一部分。" }];
    let revisionPhase = "request";
    let revisionRequest = "";
    renderMessages($("#revision-chat"), revisionMessages, "觀點修改助手（模擬 AI）");
    function scrollRevisionToLatest() {
      const chat = $("#revision-chat");
      requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
    }
    function sendRevision() {
      const input = $("#revision-input"), value = input.value.trim(); if (!value) return;
      revisionMessages.push({ role: "user", text: value });
      if (revisionPhase === "request") {
        revisionRequest = value;
        const followupQuestion = /(證據|來源|依據)/.test(value)
          ? "你希望補入哪一項材料證據？請再說明這項證據如何支持或限制目前的觀點。"
          : "為了避免直接改錯你的意思，請再說明：你希望保留什麼核心想法，以及要補充哪些條件或相反例子？";
        revisionMessages.push({ role: "ai", text: followupQuestion });
        revisionPhase = "clarification";
      } else {
        const currentSummary = editor.value.trim();
        const revisedSummary = `${currentSummary}\n\n經過修改助手對話後，我補充：${value}`;
        editor.value = revisedSummary;
        editor.readOnly = true;
        record = updateRecord(record.id, { viewpoint: revisedSummary });
        revisionMessages.push({ role: "ai", text: `我已根據你對「${revisionRequest}」的說明更新上方理解彙整。若還想調整其他部分，可以再提出新的修改需求。` });
        revisionRequest = "";
        revisionPhase = "request";
      }
      input.value = ""; renderMessages($("#revision-chat"), revisionMessages, "觀點修改助手（模擬 AI）");
      scrollRevisionToLatest();
    }
    $("#send-revision").addEventListener("click", sendRevision);
    $("#revision-input").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendRevision(); } });
    $("#confirm-summary").addEventListener("click", () => {
      if (isLocked) return;
      const viewpoint = editor.value.trim(); if (!viewpoint) { toast("觀點摘要不能是空白"); return; }
      const previousRecords = loadRecords();
      const absorbedRecordIds = new Set(previousRecords
        .filter((item) => item.integration?.status === "confirmed" && item.integration.oldId)
        .map((item) => item.integration.oldId));
      const related = previousRecords
        .filter((item) => item.id !== record.id && !absorbedRecordIds.has(item.id) && item.confirmed && consolidatedKnowledge(item))
        .map((item) => ({
          item,
          score: knowledgeRelevance(viewpoint, consolidatedKnowledge(item))
        }))
        .filter(({ score }) => score > 0)
        .sort((first, second) => second.score - first.score || new Date(second.updatedAt) - new Date(first.updatedAt))
        .slice(0, 3)
        .map(({ item, score }) => ({
          id: item.id,
          score,
          sourceType: item.integration?.status === "confirmed" ? "integration" : "viewpoint",
          reason: item.integration?.status === "confirmed" ? "與歷史整合知識有共同概念" : "與歷史確認觀點有共同概念"
        }));
      if (!related.length) {
        updateRecord(record.id, { viewpoint, confirmed: true, related: [], stage: 3, knowledgeLinksSkipped: true, confirmedConversationCount: (record.conversation || []).length });
        location.href = "database.html";
        return;
      }
      record = updateRecord(record.id, { viewpoint, confirmed: true, related, stage: 4, knowledgeLinksSkipped: false, confirmedConversationCount: (record.conversation || []).length });
      location.href = "knowledge-links.html";
    });
  }

  function initKnowledgeLinks() {
    const record = requireStage(4); if (!record) return; initStepNav(4);
    const records = loadRecords();
    const oldRecord = (record.related || [])
      .map((link) => records.find((item) => item.id === link.id))
      .find(Boolean);

    if (!oldRecord) {
      updateRecord(record.id, { knowledgeLinksSkipped: true, stage: 3 });
      location.replace("database.html");
      return;
    }

    $("#old-date").textContent = formatDate(oldRecord.createdAt, false);
    $("#old-title").textContent = oldRecord.title;
    const oldSnippet = extractRelevantSnippet(oldRecord, record.viewpoint);
    const oldKnowledge = consolidatedKnowledge(oldRecord);
    const newSnippet = extractRelevantSnippet(record, oldKnowledge);
    $("#old-snippet-label").textContent = oldRecord.integration?.status === "confirmed"
      ? "從歷史整合觀點擷取的相關文字"
      : "從歷史紀錄擷取的相關文字";
    $("#old-viewpoint").textContent = oldSnippet;
    $("#new-date").textContent = formatDate(record.createdAt, false);
    $("#new-title").textContent = record.title;
    $("#new-viewpoint").textContent = newSnippet;
    const oldKnowledgeLabel = oldRecord.integration?.status === "confirmed" ? "已完成的整合觀點" : "已確認觀點";
    $("#connection-detection").textContent = `系統以規則式文字比對，從「${oldRecord.title}」的${oldKnowledgeLabel}與「${record.title}」中擷取出可能相關的句子。這些文字可能存在共同概念、補充關係或理解差異，請透過下方問題自行判斷。`;

    const connectionChat = $("#connection-chat");
    const connectionInput = $("#connection-chat-input");
    const connectionButton = $("#send-connection-message");
    const editor = $("#integration-editor");
    const relationSelect = $("#knowledge-relation");
    const savedIntegration = record.integration;
    relationSelect.value = savedIntegration?.relationType || "";
    $("#relation-source-label").textContent = `「${oldRecord.title}」與「${record.title}」之間屬於哪一種知識關係？`;
    const guideQuestion = "這兩個觀點有哪些共同點與差異？差異可能來自來源、證據，還是你理解的改變？";
    let answer = savedIntegration?.answer || "";
    let challenge = savedIntegration?.challenge || "";
    let followup = savedIntegration?.challengeAnswer || "";
    const connectionMessages = [{ role: "ai", text: guideQuestion }];

    function makeChallenge(answer) {
      const claim = answer.length > 90 ? `${answer.slice(0, 90)}……` : answer;
      if (!/(證據|資料|來源|研究|作者|材料)/.test(answer)) {
        return `換句話挑戰：如果兩筆紀錄只是用了相似詞語，但背後依據其實不同，你仍會維持「${claim}」這個判斷嗎？請指出哪些文字或證據讓你維持或改變想法。`;
      }
      if (!/(差異|不同|衝突|矛盾|修正|挑戰|限制)/.test(answer)) {
        return `你已提到證據。再換個角度：如果新觀點不是舊觀點的補充，而是暴露了舊觀點的限制，你會如何重寫「${claim}」？`;
      }
      return `假設較新的觀點不一定比較正確，而舊觀點在特定條件下反而更適用，你原先的比較會動搖嗎？請重新說明兩者各自成立的條件，並提出你的融合判斷。`;
    }

    function makeIntegrationText(answer, followup) {
      return `我的初步比較是：${answer}\n\n經過追問與挑戰後，我對新舊觀點的融合想法是：${followup}`;
    }

    function followLatestModule(element) {
      requestAnimationFrame(() => {
        element.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }

    function showSummary(text, follow = true) {
      editor.value = text;
      editor.readOnly = true;
      $("#integration-summary").classList.remove("hidden");
      if (follow) followLatestModule($("#integration-summary"));
    }

    if (answer) connectionMessages.push({ role: "user", text: answer });
    if (challenge) connectionMessages.push({ role: "ai", text: challenge });
    if (followup) connectionMessages.push({ role: "user", text: followup });
    renderMessages(connectionChat, connectionMessages, "模擬 AI 引導");

    let connectionPhase = !answer ? "comparison" : (!followup && challenge ? "challenge" : "done");
    function syncConnectionComposer() {
      if (connectionPhase === "comparison") {
        connectionInput.placeholder = "請比較新舊觀點；Enter 送出，Shift + Enter 換行";
        connectionButton.textContent = "送出比較";
      } else if (connectionPhase === "challenge") {
        connectionInput.placeholder = "回覆 AI 的追問，說明你的想法是否改變；Enter 送出";
        connectionButton.textContent = "送出回覆";
      } else {
        connectionInput.placeholder = "比較對話已完成，請查看下方整合結果";
        connectionInput.disabled = true;
        connectionButton.disabled = true;
      }
    }
    syncConnectionComposer();
    if (savedIntegration?.text && (followup || !challenge)) showSummary(savedIntegration.text, false);

    function sendConnectionMessage() {
      const value = connectionInput.value.trim();
      if (!value) { connectionInput.focus(); return; }
      if (connectionPhase === "comparison") {
        answer = value;
        challenge = makeChallenge(answer);
        connectionMessages.push({ role: "user", text: answer }, { role: "ai", text: challenge });
        updateRecord(record.id, { integration: { status: "challenge", oldId: oldRecord.id, answer, challenge, challengeAnswer: "", text: "" } });
        connectionPhase = "challenge";
      } else if (connectionPhase === "challenge") {
        followup = value;
        connectionMessages.push({ role: "user", text: followup });
        const text = makeIntegrationText(answer, followup);
        updateRecord(record.id, { integration: { status: "draft", oldId: oldRecord.id, answer, challenge, challengeAnswer: followup, text } });
        showSummary(text);
        connectionPhase = "done";
      } else return;
      connectionInput.value = "";
      renderMessages(connectionChat, connectionMessages, "模擬 AI 引導");
      syncConnectionComposer();
      if (connectionPhase !== "done") followLatestModule($(".integration-dialogue"));
    }
    connectionButton.addEventListener("click", sendConnectionMessage);
    connectionInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendConnectionMessage(); }
    });

    $("#edit-integration").addEventListener("click", () => {
      editor.readOnly = false;
      editor.focus();
    });

    const integrationRevisionMessages = [{ role: "ai", text: "請檢查這份整合是否清楚保留新舊觀點的關係、差異與各自適用的條件。你想先調整哪一部分？" }];
    renderMessages($("#integration-revision-chat"), integrationRevisionMessages, "跨來源觀點修改助手（模擬 AI）");
    $("#open-integration-assistant").addEventListener("click", () => {
      $("#integration-revision-assistant").classList.remove("hidden");
      $("#open-integration-assistant").setAttribute("aria-expanded", "true");
      followLatestModule($("#integration-revision-assistant"));
      $("#integration-revision-input").focus();
    });
    function sendIntegrationRevision() {
      const input = $("#integration-revision-input"), value = input.value.trim();
      if (!value) return;
      const reply = /(證據|來源|依據)/.test(value)
        ? "可以分別指出新舊觀點所依據的材料，再說明兩者為何能互補，或在哪些條件下不能直接合併。"
        : "可以先保留兩個觀點的共同核心，再明確寫出差異、限制，以及你最後採取的融合判斷。";
      integrationRevisionMessages.push({ role: "user", text: value }, { role: "ai", text: reply });
      input.value = "";
      renderMessages($("#integration-revision-chat"), integrationRevisionMessages, "跨來源觀點修改助手（模擬 AI）");
      const assistantChat = $("#integration-revision-chat");
      requestAnimationFrame(() => { assistantChat.scrollTop = assistantChat.scrollHeight; });
      followLatestModule($("#integration-revision-assistant"));
    }
    $("#send-integration-revision").addEventListener("click", sendIntegrationRevision);
    $("#integration-revision-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendIntegrationRevision(); }
    });

    $("#confirm-integration").addEventListener("click", () => {
      const text = editor.value.trim();
      if (!text) { toast("整合觀點不能是空白"); return; }
      const relationType = relationSelect.value;
      if (!relationType) { toast("請先選擇兩筆知識的關係"); relationSelect.focus(); return; }
      const confirmedAt = new Date().toISOString();
      const upsertLink = (links, linkedRecordId) => [
        ...(links || []).filter((link) => link.recordId !== linkedRecordId),
        { recordId: linkedRecordId, relationType, confirmedAt }
      ];
      updateRecord(oldRecord.id, {
        knowledgeLinks: upsertLink(oldRecord.knowledgeLinks, record.id)
      });
      updateRecord(record.id, {
        integration: { status: "confirmed", oldId: oldRecord.id, answer, challenge, challengeAnswer: followup, text, relationType, confirmedAt },
        knowledgeLinks: upsertLink(record.knowledgeLinks, oldRecord.id),
        knowledgeLinksSkipped: false,
        stage: 4
      });
      location.href = "database.html";
    });
  }

  function initDatabase() {
    let records = loadRecords();
    let expandedRecordId = null;
    let guardedNaturalMax = null;
    const list = $("#record-list"), search = $("#record-search"), filter = $("#record-filter");

    function renderWithoutMovingViewport(update) {
      const scrollTop = window.scrollY;
      const scrollLeft = window.scrollX;
      document.body.style.minHeight = "";
      update();

      const naturalMax = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (scrollTop > naturalMax) {
        document.body.style.minHeight = `${Math.ceil(scrollTop + window.innerHeight + 1)}px`;
        guardedNaturalMax = naturalMax;
      } else {
        guardedNaturalMax = null;
      }

      const restore = () => window.scrollTo({ top: scrollTop, left: scrollLeft, behavior: "auto" });
      restore();
      requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
      });
    }

    window.addEventListener("scroll", () => {
      if (guardedNaturalMax === null || window.scrollY > guardedNaturalMax) return;
      document.body.style.minHeight = "";
      guardedNaturalMax = null;
    }, { passive: true });

    function recordStatus(record) {
      if (record.integration?.status === "confirmed") return "completed";
      if (record.confirmed && (record.knowledgeLinksSkipped || !(record.related || []).length)) return "saved";
      if (record.confirmed) return "incomplete";
      return "progress";
    }

    function statusLabel(record) {
      const status = recordStatus(record);
      if (status === "completed") return "已完成整合";
      if (status === "saved") return "觀點已保存";
      if (status === "incomplete") return "尚未完成整合";
      return "進行中";
    }

    function editTarget(record) {
      const status = recordStatus(record);
      if (status === "incomplete") return "knowledge-links.html";
      const stage = stageOf(record);
      if (stage >= 3) return "viewpoint.html";
      if (stage === 2) return "dialogue.html";
      return "index.html";
    }

    function render() {
      const query = search.value.trim().toLowerCase();
      const mode = filter.value;
      const visible = records.filter((record) => {
        const searchable = `${record.title} ${record.rawText} ${record.viewpoint} ${record.integration?.text || ""} ${record.integration?.relationType || ""}`.toLowerCase();
        const matchesText = searchable.includes(query);
        const matchesStatus = mode === "all" || recordStatus(record) === mode;
        return matchesText && matchesStatus;
      });

      $("#record-count").textContent = `${visible.length} 筆紀錄`;
      if (!visible.length) {
        list.innerHTML = `<div class="empty">沒有符合條件的學習紀錄。</div>`;
        return;
      }

      list.innerHTML = visible.map((record) => {
        const isExpanded = expandedRecordId === record.id;
        const displayKnowledge = consolidatedKnowledge(record) || record.rawText;
        const chatHTML = (record.conversation || []).length
          ? record.conversation.map((message) => `<div class="message ${message.role === "user" ? "user" : "ai"}"><small>${message.role === "user" ? "學習者" : "模擬 AI"}</small>${escapeHTML(message.text)}</div>`).join("")
          : `<p class="muted">尚無學習對話。</p>`;
        const detailHTML = isExpanded ? `
          <section class="inline-record-detail" aria-label="${escapeHTML(record.title)}的詳細紀錄">
            <p class="eyebrow">Record detail</p>
            <div class="stack inline-detail-stack">
              <details open><summary>原始材料</summary><div class="viewpoint">${escapeHTML(record.rawText || "尚無原始材料。")}</div></details>
              <details><summary>學習對話</summary><div class="chat">${chatHTML}</div></details>
              <details><summary>確認觀點</summary><div class="viewpoint">${escapeHTML(record.viewpoint || "尚未確認觀點。")}</div></details>
              <details><summary>整合紀錄</summary><div class="viewpoint">${record.integration?.relationType ? `<p><strong>知識關係：</strong>${escapeHTML(record.integration.relationType)}</p>` : ""}${escapeHTML(record.integration?.text || (recordStatus(record) === "saved" ? "觀點已保存" : "尚無跨來源整合紀錄。"))}</div></details>
            </div>
          </section>` : "";
        return `
          <div class="record-entry ${isExpanded ? "expanded" : ""}">
            <article class="record-card ${isExpanded ? "active" : ""}">
              <div>
                <div class="row"><span class="tag">${escapeHTML(formatDate(record.createdAt))}</span><span class="tag yellow">${statusLabel(record)}</span></div>
                <h3>${escapeHTML(record.title)}</h3>
                <p>${escapeHTML(displayKnowledge.slice(0, 100))}${displayKnowledge.length > 100 ? "…" : ""}</p>
              </div>
              <div class="record-actions">
                <button class="btn view-record" data-id="${record.id}" type="button" aria-expanded="${isExpanded}">${isExpanded ? "收起" : "查看"}</button>
                ${["progress", "incomplete"].includes(recordStatus(record)) ? `<button class="btn btn-primary edit-record" data-id="${record.id}" type="button">編輯</button>` : ""}
                <button class="btn btn-danger delete-record" data-id="${record.id}" type="button">刪除</button>
              </div>
            </article>
            ${detailHTML}
          </div>`;
      }).join("");

      $$(".view-record").forEach((button) => button.addEventListener("click", () => toggleDetail(button.dataset.id)));
      $$(".edit-record").forEach((button) => button.addEventListener("click", () => {
        const record = records.find((item) => item.id === button.dataset.id);
        if (!record || !["progress", "incomplete"].includes(recordStatus(record))) return;
        setActive(record.id);
        location.href = editTarget(record);
      }));
      $$(".delete-record").forEach((button) => button.addEventListener("click", () => deleteRecord(button.dataset.id)));
    }

    function toggleDetail(id) {
      renderWithoutMovingViewport(() => {
        expandedRecordId = expandedRecordId === id ? null : id;
        render();
      });
    }

    function deleteRecord(id) {
      const record = records.find((item) => item.id === id);
      if (!record || !confirm(`確定刪除「${record.title}」？刪除後無法復原。`)) return;
      records = records.filter((item) => item.id !== id);
      saveRecords(records);
      if (activeId() === id) localStorage.removeItem(ACTIVE_KEY);
      if (expandedRecordId === id) expandedRecordId = null;
      render();
      toast("學習紀錄已刪除");
    }

    search.addEventListener("input", render);
    filter.addEventListener("change", render);
    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    setClock();
    $$("a[aria-label='回到學習首頁']").forEach((homeLink) => {
      homeLink.addEventListener("click", () => localStorage.removeItem(ACTIVE_KEY));
    });
    const page = document.body.dataset.page;
    if (page === "upload") initUpload(); if (page === "dialogue") initDialogue(); if (page === "viewpoint") initViewpoint(); if (page === "knowledge-links") initKnowledgeLinks(); if (page === "database") initDatabase();
    if (page === "integration") location.replace("knowledge-links.html");
  });
})();
