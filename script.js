// Hard 75 – vanilla JS tracker
// User-scoped storage + cloud-aware streaks with strict guest isolation.

(function () {
  "use strict";

  // ---- User-aware storage keys ----
  function currentUid() {
    return window.hard75UserId || "guest";
  }
  function keyDays(uid = currentUid()) {
    return `hard75:${uid}:days`;
  }
  function keyLongest(uid = currentUid()) {
    return `hard75:${uid}:longest`;
  }

  // --- Helpers ---
  const $ = (sel, root = document) => root.querySelector(sel);
  const pad = n => String(n).padStart(2, "0");
  // Local (browser timezone) day key
  const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; // YYYY-MM-DD
  // Step a YYYY-MM-DD string back by N days
  const keyMinusDays = (key, days = 1) => {
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - days);
    return todayKey(dt);
  };

  // Save an incomplete snapshot of today's form (autosave)
  function savePartial(form) {
    const payload = readForm(form);
    const record = { ...payload, complete: false, savedAt: new Date().toISOString() };
    saveDay(todayKey(), record);
    // If you later enable cloud partial-sync, uncomment:
    // window.syncPartialToday?.(record);
    renderStatus();
    computeStreaks();
    renderLog();
  }

  function getAll() { try { return JSON.parse(localStorage.getItem(keyDays()) || "{}"); } catch { return {}; } }
  function setAll(obj) { localStorage.setItem(keyDays(), JSON.stringify(obj)); }
  function getDay(dateKey) { return getAll()[dateKey] || null; }
  function saveDay(dateKey, data) { const all = getAll(); all[dateKey] = data; setAll(all); }
  function removeDay(dateKey) { const all = getAll(); delete all[dateKey]; setAll(all); }

  function missingReasons(form) {
    const reasons = [];
    if (!form.workout1.checked) reasons.push("Workout 1 is not completed.");
    if (!form.workout2.checked) reasons.push("Workout 2 is not completed.");
    if (!form.diet.checked) reasons.push("Diet requirement is not met.");
    if (!form.photo.checked) reasons.push("Progress photo not taken.");
    if (!form.reading.checked) reasons.push("Reading (10+ pages) not completed.");
    const cups = Number(document.querySelector("input[name='waterCups']").value || 0);
    if (cups < 10) reasons.push(`Water intake is short by ${10 - cups} cup(s) of 400ml.`);
    return reasons;
  }

  // Prefer cloud (only if it matches this uid), else local
  function renderStatus() {
    const bar = $("#statusBar");
    if (!bar) return;
    const key = todayKey();
    let entry = null;

    if (Array.isArray(window.cloudLog) && window.cloudLogUid === currentUid()) {
      const row = window.cloudLog.find(r => r?.date === key);
      if (row) entry = { complete: !!row.complete, savedAt: row.savedAt };
    }
    if (!entry) entry = getDay(key);

    const dateStr = new Date().toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "short", day: "numeric"
    });
    const dateEl = $("#dateDisplay");
    if (dateEl) dateEl.textContent = dateStr;

    if (!entry) {
      bar.innerHTML = `
        <span class="badge">Not submitted yet</span>
        <span style="margin-left:.5rem;">You haven’t submitted progress for <strong>${key}</strong> yet.</span>
      `;
    } else if (entry?.complete === true) {
      let timeText = "";
      try {
        if (entry.savedAt && typeof entry.savedAt === "object" && "toDate" in entry.savedAt) {
          timeText = new Date(entry.savedAt.toDate()).toLocaleTimeString();
        } else if (typeof entry.savedAt === "string") {
          timeText = new Date(entry.savedAt).toLocaleTimeString();
        }
      } catch {}
      bar.innerHTML = `
        <span class="badge ok">Submitted</span>
        <span style="margin-left:.5rem;">All activities recorded for <strong>${key}</strong>${timeText ? ` at ${timeText}` : ""}.</span>
      `;
    } else {
      bar.innerHTML = `
        <span class="badge miss">Incomplete</span>
        <span style="margin-left:.5rem;">There’s an incomplete attempt saved for <strong>${key}</strong>. Keep going — I’ll remember your progress.</span>
      `;
    }
  }

  function loadToday() {
    const form = $("#dailyForm");
    if (!form) return;

    const entry = getDay(todayKey());
    // Only restore partial progress; if the day was submitted, start fresh.
    if (entry && entry.complete === true) { form.reset(); setWater(0); return; }

    if (!entry) { form.reset(); setWater(0); return; }
    form.workout1.checked = !!entry.workout1;
    form.workout2.checked = !!entry.workout2;
    form.diet.checked = !!entry.diet;
    form.photo.checked = !!entry.photo;
    form.reading.checked = !!entry.reading;
    setWater(entry.waterCups || 0);
  }

  function setWater(cups) {
    cups = Math.max(0, Math.min(20, Number(cups) || 0));
    const hidden = document.querySelector("input[name='waterCups']");
    const out = document.getElementById("waterCups");
    if (hidden) hidden.value = String(cups);
    if (out) { out.value = String(cups); out.textContent = String(cups); }
  }

  function computeStreaks() {
    const uid = currentUid();

    // helpers to compute streaks from a set of YYYY-MM-DD strings
    const calcCurrentFromSet = (completeSet) => {
      const today = todayKey();
      // find the last completed day <= today
      const completedAsc = Array.from(completeSet).sort(); // asc
      let last = null;
      for (let i = completedAsc.length - 1; i >= 0; i--) {
        if (completedAsc[i] <= today) { last = completedAsc[i]; break; }
      }
      if (!last) return 0;
      // count back consecutively from 'last'
      let current = 0;
      let k = last;
      while (completeSet.has(k)) {
        current++;
        k = keyMinusDays(k, 1);
      }
      return current;
    };

    const calcLongestFromSet = (completeSet) => {
      const datesAsc = Array.from(completeSet).sort(); // asc
      let longest = 0, run = 0, prev = null;
      for (const k of datesAsc) {
        if (!prev) {
          run = 1;
        } else {
          // consecutive if prev + 1 day === k
          const nextOfPrev = keyMinusDays(k, 1);
          run = (nextOfPrev === prev) ? run + 1 : 1;
        }
        prev = k;
        if (run > longest) longest = run;
      }
      return longest;
    };

    // ---- Prefer cloud data if present for this uid ----
    if (Array.isArray(window.cloudLog) && window.cloudLogUid === uid) {
      const completeSet = new Set(
        window.cloudLog.filter(e => e && e.complete && e.date).map(e => e.date)
      );

      const current = calcCurrentFromSet(completeSet);
      const longestFromData = calcLongestFromSet(completeSet);

      const stored = Number(localStorage.getItem(keyLongest(uid)) || 0);
      const longest = Math.max(stored, longestFromData, current);
      if (longest > stored) localStorage.setItem(keyLongest(uid), String(longest));

      const cs = document.getElementById("currentStreak");
      const ls = document.getElementById("longestStreak");
      if (cs) cs.textContent = String(current);
      if (ls) ls.textContent = String(longest);
      return;
    }

    // ---- Fallback to local cache for this uid ----
    const all = (() => { try { return JSON.parse(localStorage.getItem(keyDays(uid)) || "{}"); } catch { return {}; } })();
    const completeSet = new Set(
      Object.entries(all).filter(([, v]) => v && v.complete).map(([k]) => k)
    );

    const current = calcCurrentFromSet(completeSet);
    const longestFromData = calcLongestFromSet(completeSet);

    const stored = Number(localStorage.getItem(keyLongest(uid)) || 0);
    const longest = Math.max(stored, longestFromData, current);
    if (longest > stored) localStorage.setItem(keyLongest(uid), String(longest));

    const cs = document.getElementById("currentStreak");
    const ls = document.getElementById("longestStreak");
    if (cs) cs.textContent = String(current);
    if (ls) ls.textContent = String(longest);
  }

  function renderLog() {
    const list = document.getElementById("logList");
    if (!list) return;
    list.innerHTML = "";

    if (Array.isArray(window.cloudLog) && window.cloudLogUid === currentUid() && window.cloudLog.length) {
      for (const e of window.cloudLog) {
        const li = document.createElement("li");
        const badge = document.createElement("span");
        badge.className = `badge ${e.complete ? "ok" : "miss"}`;
        badge.textContent = e.complete ? "Complete" : "Incomplete";
        li.innerHTML = `<strong>${e.date}</strong>`;
        li.appendChild(badge);
        list.appendChild(li);
      }
      computeStreaks();
      renderStatus();
      return;
    }

    // fallback to local for this uid
    const all = getAll();
    const keys = Object.keys(all).sort().reverse();
    for (const k of keys) {
      const e = all[k];
      const li = document.createElement("li");
      const badge = document.createElement("span");
      badge.className = `badge ${e.complete ? "ok" : "miss"}`;
      badge.textContent = e.complete ? "Complete" : "Incomplete";
      li.innerHTML = `<strong>${k}</strong>`;
      li.appendChild(badge);
      list.appendChild(li);
    }
  }

  function showStatusMessage(html, type = "info") {
    const bar = document.getElementById("statusBar");
    if (!bar) return;
    const color = type === "error" ? "var(--danger)" : type === "success" ? "var(--accent)" : "var(--accent-2)";
    bar.innerHTML = `<span style="font-weight:700; color:${color}; margin-right:.35rem;">${type.toUpperCase()}:</span>&nbsp;${html}`;
  }

  function readForm(form) {
    return {
      workout1: form.workout1.checked,
      workout2: form.workout2.checked,
      diet: form.diet.checked,
      photo: form.photo.checked,
      reading: form.reading.checked,
      waterCups: Number(document.querySelector("input[name='waterCups']").value || 0),
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("dailyForm");
    const inc = document.getElementById("incWater");
    const dec = document.getElementById("decWater");

    // Live countdown (only if provided elsewhere)
    if (typeof window.startCountdown === "function") {
      window.startCountdown();
    }

    // Check day rollover every 30s (resets UI when date changes)
    let lastKey = todayKey();
    setInterval(() => {
      const tk = todayKey();
      if (tk !== lastKey) {
        lastKey = tk;
        form?.reset();
        setWater(0);
        showStatusMessage("A new day started — tracker reset for today.", "info");
        renderStatus();
        computeStreaks();
        renderLog();
      }
    }, 30000);

    // Water autosave
    inc?.addEventListener("click", () => {
      setWater(Number(document.querySelector("input[name='waterCups']").value) + 1);
      if (form) savePartial(form);
    });
    dec?.addEventListener("click", () => {
      setWater(Number(document.querySelector("input[name='waterCups']").value) - 1);
      if (form) savePartial(form);
    });

    // Autosave on any required checkbox change
    ["workout1","workout2","diet","photo","reading"].forEach(name => {
      form?.elements[name]?.addEventListener("change", () => savePartial(form));
    });

    // Real sign-out button: visible reset + banner (auth.js also calls this on true sign-out)
    document.getElementById("logoutBtn")?.addEventListener("click", () => {
      window.clearLocalTracker?.({ preserveUserCaches: true, force: true, silent: false });
    });

    if (form) {
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const reasons = missingReasons(form);
        if (reasons.length > 0) {
          const list = "<ul style='margin:.25rem 0 0 .75rem'>" + reasons.map(r => `<li>${r}</li>`).join("") + "</ul>";
          showStatusMessage(`Progress was<strong> not saved </strong>because:<br>${list}`, "error");
          return;
        }
        const payload = readForm(form);
        const record = { ...payload, complete: true, savedAt: new Date().toISOString() };
        saveDay(todayKey(), record);                  // local
        window.syncLogWriteToday?.({ complete: true }).catch(()=>{});
        showStatusMessage("Nice! All activities complete and your progress for today was saved.", "success");
        // Restart after successful submit
        form.reset();
        setWater(0);
        renderStatus();
        computeStreaks();
        renderLog();
      });

      document.getElementById("resetBtn")?.addEventListener("click", () => {
        removeDay(todayKey());
        window.syncLogDeleteToday?.().catch(()=>{});
        form.reset();
        setWater(0);
        showStatusMessage("Today was reset. You can submit again when everything is complete.", "info");
        renderStatus();
        computeStreaks();
        renderLog();
      });
    }

    // Initial paint
    renderStatus();
    loadToday();
    computeStreaks();
    renderLog();

    // Optional: single-tab presence
    if (typeof window.setupSingleInstanceHints === "function") {
      window.setupSingleInstanceHints();
    }
  });

  // Expose helpers for auth.js
  window.renderLog = renderLog;
  window.renderStatus = renderStatus;
  window.computeStreaks = computeStreaks;
  window.loadToday = loadToday;

  // --- Guest cache tools ---
  window.clearGuestCache = function () {
    try {
      Object.keys(localStorage).forEach(k => { if (k.startsWith('hard75:guest:')) localStorage.removeItem(k); });
    } catch {}
  };

  /**
   * Clear/refresh UI on sign-out or boot.
   * Default: NON-DESTRUCTIVE + SILENT (keeps local progress).
   * Use { force:true } for a real sign-out reset (e.g., Logout button).
   */
  window.clearLocalTracker = function ({ preserveUserCaches = true, force = false, silent = true } = {}) {
    try {
      if (!preserveUserCaches) {
        // Full wipe of all namespaces (explicit only)
        Object.keys(localStorage).forEach(k => { if (k.startsWith('hard75:')) localStorage.removeItem(k); });
      }
      // IMPORTANT: we no longer auto-clear the guest namespace on boot/refresh.
    } catch {}

    const form = document.getElementById("dailyForm");

    if (force) {
      // Real sign-out UX: reset visible UI
      if (form) form.reset();
      setWater(0);

      window.cloudLog = null;
      window.cloudLogUid = null;

      const cs = document.getElementById("currentStreak");
      const ls = document.getElementById("longestStreak");
      if (cs) cs.textContent = "0";
      if (ls) ls.textContent = "0";

      renderStatus();
      renderLog();

      if (!silent) {
        showStatusMessage("Signed out — local data cleared from the view. Your per-user caches were preserved.", "info");
      }
    } else {
      // Non-destructive boot/refresh: sync UI with stored state (no banner)
      renderStatus();
      loadToday();
      computeStreaks();
      renderLog();
    }
  };

})();
