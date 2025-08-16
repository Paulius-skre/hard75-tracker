// auth.js — Firebase boot + Auth wiring with user-scoped UI and logs (preloads + guest purge)

(async () => {
  function showStatus(html, type = "info") {
    const bar = document.getElementById("statusBar");
    if (!bar) return;
    const color = type === "error" ? "var(--danger)" : type === "success" ? "var(--accent)" : "var(--accent-2)";
    bar.innerHTML = `<span style="font-weight:700; color:${color}; margin-right:.35rem;">${type.toUpperCase()}:</span>&nbsp;${html}`;
  }

  if (document.readyState === "loading") {
    await new Promise(res => document.addEventListener("DOMContentLoaded", res, { once: true }));
  }

  // Config: local file first, then Hosting
  async function getFirebaseConfig() {
    if (window.FIREBASE_CONFIG && Object.keys(window.FIREBASE_CONFIG).length) return window.FIREBASE_CONFIG;
    try {
      const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {}
    throw new Error("Firebase config not found. Load ./firebase-config.js locally, or run Hosting/emulator.");
  }

  let cfg;
  try { cfg = await getFirebaseConfig(); }
  catch (e) { console.error(e); showStatus(e.message || String(e), "error"); return; }

  // Import SDKs
  let initializeApp, getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut;
  let getFirestore, doc, setDoc, serverTimestamp, collection, onSnapshot, query, orderBy, limit, deleteDoc, getDocs;

  try {
    ({ initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"));
    ({ getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut }
      = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"));
    ({ getFirestore, doc, setDoc, serverTimestamp, collection, onSnapshot, query, orderBy, limit, deleteDoc, getDocs }
      = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"));
  } catch (e) {
    console.error("Failed to import Firebase modules.", e);
    showStatus("Couldn’t load Firebase modules. Allow https://www.gstatic.com.", "error");
    return;
  }

  // Init Firebase
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);

  try { await getRedirectResult(auth); } catch {}

  // UI
  const loginBtn  = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userLabel = document.getElementById("userLabel");
  const provider = new GoogleAuthProvider();

  loginBtn?.addEventListener("click", async () => {
    try {
      showStatus("Opening Google login…", "info");
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (e?.code === "auth/popup-blocked" || e?.code === "auth/cancelled-popup-request") {
        showStatus("Popup blocked. Redirecting to Google login…", "info");
        await signInWithRedirect(auth, provider);
      } else if (e?.code === "auth/popup-closed-by-user") {
        showStatus("Login popup was closed before completing.", "error");
      } else {
        console.error("Login error:", e);
        showStatus(`Login failed: ${e?.message || e}`, "error");
      }
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    try { await signOut(auth); }
    catch (e) { showStatus(`Sign out failed: ${e?.message || e}`, "error"); }
  });

  // Firestore helpers
  const todayKey = () => new Date().toISOString().slice(0,10);

  async function writeTodayLog({ complete }) {
    const u = auth.currentUser; if (!u) return;
    await setDoc(doc(db, "users", u.uid, "logs", todayKey()), {
      date: todayKey(), complete: !!complete, savedAt: serverTimestamp()
    }, { merge: true });
  }
  async function deleteTodayLog() {
    const u = auth.currentUser; if (!u) return;
    await deleteDoc(doc(db, "users", u.uid, "logs", todayKey()));
  }

  let unsubscribeLogs = null;

  async function preloadAndListen(uid) {
    if (unsubscribeLogs) unsubscribeLogs();

    // Tag target uid & clear any old buffer
    window.cloudLog = null;
    window.cloudLogUid = uid;

    const q = query(collection(db, "users", uid, "logs"), orderBy("date", "desc"), limit(100));

    // --- PRELOAD once so UI updates immediately ---
    try {
      const snap = await getDocs(q);
      const preRows = [];
      snap.forEach(d => preRows.push(d.data()));
      window.cloudLog = preRows;
      window.cloudLogUid = uid;
      window.renderLog?.();
      window.computeStreaks?.();
      window.renderStatus?.();
    } catch (e) {
      console.warn("Preload getDocs failed:", e);
    }

    // --- Realtime updates ---
    unsubscribeLogs = onSnapshot(q, snap => {
      const rows = [];
      snap.forEach(d => rows.push(d.data()));
      window.cloudLog = rows;
      window.cloudLogUid = uid;

      window.renderLog?.();
      window.computeStreaks?.();
      window.renderStatus?.();
    });
  }

  // Auth state → UI + namespace
  onAuthStateChanged(auth, (user) => {
    if (user) {
      // Switch to user's namespace
      window.hard75UserId = user.uid;

      // Purge any guest cache so it doesn't leak into this session
      window.clearGuestCache?.();

      if (loginBtn)  loginBtn.style.display = "none";
      if (logoutBtn) logoutBtn.style.display = "inline-block";
      if (userLabel) userLabel.textContent = `Signed in`;

      // Paint from local (namespaced) immediately while cloud loads
      document.getElementById("currentStreak").textContent = "0";
      const localLongest = Number(localStorage.getItem(`hard75:${user.uid}:longest`) || 0);
      document.getElementById("longestStreak").textContent = String(localLongest);

      window.cloudLog = null;
      window.cloudLogUid = user.uid;

      window.renderLog?.();     // clears now
      window.loadToday?.();     // load local for this user
      window.renderStatus?.();  // "Not submitted yet" until we see data
      window.computeStreaks?.();// compute from local immediately

      // Preload + listen to this user's cloud data
      preloadAndListen(user.uid);
      showStatus("Logged in successfully.", "success");
    } else {
      // signed out
      window.hard75UserId = null;

      if (loginBtn)  loginBtn.style.display = "inline-block";
      if (logoutBtn) logoutBtn.style.display = "none";
      if (userLabel) userLabel.textContent = "";

      if (unsubscribeLogs) unsubscribeLogs();
      unsubscribeLogs = null;

      window.cloudLog = null;
      window.cloudLogUid = null;

      // Reset UI but KEEP per-UID caches (so users' data shows when they come back)
      window.clearLocalTracker?.({ preserveUserCaches: true });
    }
  });

  // expose hooks to script.js
  window.syncLogWriteToday = writeTodayLog;
  window.syncLogDeleteToday = deleteTodayLog;
})();
