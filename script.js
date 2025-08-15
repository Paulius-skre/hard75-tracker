// Hard 75 – vanilla JS tracker
// Optimized for readability, modularity, and resilience.

const STORAGE_KEY = "hard75:days";
const LONGEST_KEY = "hard75:longest";


(function () {
  "use strict";

  // --- Helpers ---
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const todayKey = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const STORAGE_KEY = "hard75:days";

  /** Get all saved days as a map { 'YYYY-MM-DD': DayRecord } */
  function getAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  /** Save all days */
  function setAll(obj) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  }

  /** Return entry for date, or null */
  function getDay(dateKey) {
    return getAll()[dateKey] || null;
  }

  /** Save a day entry */
  function saveDay(dateKey, data) {
    const all = getAll();
    all[dateKey] = data;
    setAll(all);
  }

  /** Remove a day entry */
  function removeDay(dateKey) {
    const all = getAll();
    delete all[dateKey];
    setAll(all);
  }

  /** Build a list of reasons why the entry is invalid */
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

  /** Render status bar for today */
  function renderStatus() {
    const bar = $("#statusBar");
    const key = todayKey();
    const entry = getDay(key);
    const dateStr = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" });
    $("#dateDisplay").textContent = dateStr;

    if (!entry) {
      bar.innerHTML = `
        <span class="badge">Not submitted yet</span>
        <span style="margin-left:.5rem;">You haven’t submitted progress for <strong>${key}</strong> yet.</span>
      `;
    } else if (entry?.complete === true) {
      bar.innerHTML = `
        <span class="badge ok">Submitted</span>
        <span style="margin-left:.5rem;">All activities recorded for <strong>${key}</strong> at ${new Date(entry.savedAt).toLocaleTimeString()}.</span>
      `;
    } else {
      bar.innerHTML = `
        <span class="badge miss">Incomplete</span>
        <span style="margin-left:.5rem;">There’s an incomplete attempt saved for <strong>${key}</strong>. Consider resetting and re-saving.</span>
      `;
    }
  }

  /** Populate today's form from storage */
  function loadToday() {
    const form = $("#dailyForm");
    const entry = getDay(todayKey());
    if (!entry) {
      form.reset();
      setWater(0);
      return;
    }
    form.workout1.checked = !!entry.workout1;
    form.workout2.checked = !!entry.workout2;
    form.diet.checked = !!entry.diet;
    form.photo.checked = !!entry.photo;
    form.reading.checked = !!entry.reading;
    setWater(entry.waterCups || 0);
  }

  /** Update water UI */
  function setWater(cups) {
    cups = Math.max(0, Math.min(20, Number(cups) || 0)); // clamp 0..20 (8L hard cap)
    $("input[name='waterCups']").value = String(cups);
    $("#waterCups").value = String(cups);
    $("#waterCups").textContent = String(cups);
  }

  /** Compute streaks */
  function computeStreaks() {
    const all = getAll();
    const keys = Object.keys(all).filter(Boolean).sort(); // asc
  
    // ---- current streak (up to today) ----
    let current = 0;
    const today = new Date(todayKey());
    let d = new Date(today);
    while (true) {
      const k = d.toISOString().slice(0,10);
      const e = all[k];
      if (e && e.complete) {
        current++;
        d.setDate(d.getDate() - 1);
      } else break;
    }
  
    // ---- longest streak found in saved per-day data ----
    let longestFromData = 0;
    let run = 0, prev = null;
    for (const k of keys) {
      const e = all[k];
      if (!(e && e.complete)) { run = 0; prev = null; continue; }
      if (!prev) { run = 1; prev = k; longestFromData = Math.max(longestFromData, run); continue; }
      const prevDate = new Date(prev);
      const currDate = new Date(k);
      const diff = (currDate - prevDate) / (1000*60*60*24);
      run = (diff === 1) ? run + 1 : 1;
      prev = k;
      if (run > longestFromData) longestFromData = run;
    }
  
    // ---- all-time longest that never goes down ----
    const storedLongest = Number(localStorage.getItem(LONGEST_KEY) || 0);
    const longest = Math.max(storedLongest, longestFromData, current);
  
    // Persist only if we actually beat the stored record
    if (longest > storedLongest) {
      localStorage.setItem(LONGEST_KEY, String(longest));
    }
  
    // Update UI
    $("#currentStreak").textContent = String(current);
    $("#longestStreak").textContent = String(longest);
    // after updating localStorage and before renderStatus()/computeStreaks()
    const afterRecalc = () => {
      computeStreaks();
      const current = Number($("#currentStreak").textContent || 0);
      const longest = Number($("#longestStreak").textContent || 0);
      const lastCompletionDate = todayKey();
      if (window.syncStreaksToCloud) {
        window.syncStreaksToCloud({ currentStreak: current, longestStreak: longest, lastCompletionDate }).catch(()=>{});
      }
    };
  }

showStatusMessage("Nice! All activities complete and your progress for today was saved.", "success");
renderStatus();
afterRecalc();
renderLog();

  /** Render submission log */
  function renderLog() {
    const list = $("#logList"); list.innerHTML = "";
    const cloud = window.cloudLog;
    if (Array.isArray(cloud) && cloud.length) {
      for (const e of cloud) {
        const li = document.createElement("li");
        const badge = document.createElement("span");
        badge.className = `badge ${e.complete ? "ok" : "miss"}`;
        badge.textContent = e.complete ? "Complete" : "Incomplete";
        li.innerHTML = `<strong>${e.date}</strong>`;
        li.appendChild(badge); list.appendChild(li);
      }
      return;
    }
    // fallback to local
    const all = getAll(); const keys = Object.keys(all).sort().reverse();
    for (const k of keys) {
      const e = all[k];
      const li = document.createElement("li");
      const badge = document.createElement("span");
      badge.className = `badge ${e.complete ? "ok" : "miss"}`;
      badge.textContent = e.complete ? "Complete" : "Incomplete";
      li.innerHTML = `<strong>${k}</strong>`;
      li.appendChild(badge); list.appendChild(li);
    }
  }

  /** Show a message in the status bar (reason for failure, etc.) */
  function showStatusMessage(html, type = "info") {
    const bar = $("#statusBar");
    const color = type === "error" ? "var(--danger)" : type === "success" ? "var(--accent)" : "var(--accent-2)";
    bar.innerHTML = `<span style="font-weight:700; color:${color}; margin-right:.35rem;">${type.toUpperCase()}:</span>&nbsp;${html}`;
  }

  /** Collect today's payload from the form */
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

  // --- Event wiring ---
  document.addEventListener("DOMContentLoaded", () => {
    const form = $("#dailyForm");
    $("#incWater").addEventListener("click", () => setWater(Number($("input[name='waterCups']").value) + 1));
    $("#decWater").addEventListener("click", () => setWater(Number($("input[name='waterCups']").value) - 1));

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const reasons = missingReasons(form);
      if (reasons.length > 0) {
        // Feature 1: Block save + tell user why
        const list = "<ul style='margin:.25rem 0 0 .75rem'>" + reasons.map(r => `<li>${r}</li>`).join("") + "</ul>";
        showStatusMessage(`Progress was<strong> not saved </strong>because:<br>${list}`, "error");
        return;
      }

      // All good – persist
      const payload = readForm(form);
      const record = {
        ...payload,
        complete: true,
        savedAt: new Date().toISOString(),
      };
      saveDay(todayKey(), record);
      if (window.syncLogWriteToday) window.syncLogWriteToday({ complete: true }).catch(()=>{});
      showStatusMessage("Nice! All activities complete and your progress for today was saved.", "success");
      renderStatus();
      computeStreaks();
      renderLog();
    });

    $("#resetBtn").addEventListener("click", () => {
      removeDay(todayKey());
      // Delete today from Firestore log if signed in
      if (window.syncLogDeleteToday) {
        window.syncLogDeleteToday().catch(()=>{});
      }
      form.reset();
      setWater(0);
      showStatusMessage("Today was reset. You can submit again when everything is complete.", "info");
      renderStatus();
      computeStreaks();
      renderLog();
    });

    // Initial paint
    renderStatus();
    loadToday();
    computeStreaks();
    renderLog();
  });
})();
