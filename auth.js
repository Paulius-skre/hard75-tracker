// auth.js — Firebase boot + Auth wiring (ESM, robust errors, popup→redirect fallback)

(async () => {
    // status helper (uses your existing status bar)
    function showStatus(html, type = "info") {
      const bar = document.getElementById("statusBar");
      if (!bar) return;
      const color = type === "error" ? "var(--danger)" : type === "success" ? "var(--accent)" : "var(--accent-2)";
      bar.innerHTML = `<span style="font-weight:700; color:${color}; margin-right:.35rem;">${type.toUpperCase()}:</span>&nbsp;${html}`;
    }
  
    // Ensure DOM is ready so #loginBtn exists
    if (document.readyState === "loading") {
      await new Promise(res => document.addEventListener("DOMContentLoaded", res, { once: true }));
    }
  
    // 1) Get config: local file first, then Hosting endpoint
    async function getFirebaseConfig() {
      if (window.FIREBASE_CONFIG) return window.FIREBASE_CONFIG; // from firebase-config.js (dev)
      try {
        const res = await fetch("/__/firebase/init.json"); // works on Firebase Hosting & emulator
        if (res.ok) return await res.json();
      } catch {}
      throw new Error("Firebase config not found. Create firebase-config.js for local dev, or deploy to Firebase Hosting.");
    }
  
    let cfg;
    try {
      cfg = await getFirebaseConfig();
    } catch (e) {
      console.error(e);
      showStatus(e.message || String(e), "error");
      return;
    }
  
    // 2) Import SDKs (ESM from gstatic)
    let initializeApp, getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut;
    let getFirestore, doc, setDoc, serverTimestamp, collection, onSnapshot, query, orderBy, limit, deleteDoc;
  
    try {
      ({ initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"));
      ({ getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut }
        = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"));
      ({ getFirestore, doc, setDoc, serverTimestamp, collection, onSnapshot, query, orderBy, limit, deleteDoc }
        = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"));
    } catch (e) {
      // Most common cause: CSP blocks gstatic, or ad/script blockers.
      console.error("Failed to import Firebase ESM modules.", e);
      showStatus(
        "Couldn’t load Firebase modules. Check that your CSP allows https://www.gstatic.com and that no blocker is preventing it.",
        "error"
      );
      return;
    }
  
    // 3) Init Firebase
    const app = initializeApp(cfg);
    const auth = getAuth(app);
    const db = getFirestore(app);
  
    // 3a) If we used redirect last time, resolve it (ignore “no redirect” errors)
    try { await getRedirectResult(auth); } catch {}
  
    // 4) Wire buttons
    const loginBtn  = document.getElementById("loginBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const userLabel = document.getElementById("userLabel");
  
    const provider = new GoogleAuthProvider();
  
    if (loginBtn) {
      loginBtn.type = "button";
      loginBtn.addEventListener("click", async () => {
        try {
          await signInWithPopup(auth, provider);
          // onAuthStateChanged will handle UI
        } catch (e) {
          // fallback to redirect for popup issues
          if (e?.code === "auth/popup-blocked" || e?.code === "auth/cancelled-popup-request") {
            showStatus("Popup blocked. Switching to redirect login…", "info");
            await signInWithRedirect(auth, provider);
          } else if (e?.code === "auth/popup-closed-by-user") {
            showStatus("Login popup was closed before completing.", "error");
          } else {
            console.error("Login error:", e);
            showStatus(`Login failed: ${e?.message || e}`, "error");
          }
        }
      });
    }
  
    if (logoutBtn) {
      logoutBtn.type = "button";
      logoutBtn.addEventListener("click", async () => {
        try {
          await signOut(auth);
        } catch (e) {
          showStatus(`Sign out failed: ${e?.message || e}`, "error");
        }
      });
    }
  
    // 5) Firestore log helpers (same as before, just moved here)
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
    function attachLogListener(uid) {
      if (unsubscribeLogs) unsubscribeLogs();
      const q = query(collection(db, "users", uid, "logs"), orderBy("date","desc"), limit(100));
      unsubscribeLogs = onSnapshot(q, snap => {
        const rows = []; snap.forEach(d => rows.push(d.data()));
        window.cloudLog = rows;
        window.renderLog?.(); // provided by script.js
      });
    }
  
    onAuthStateChanged(auth, (user) => {
      if (user) {
        if (loginBtn)  loginBtn.style.display = "none";
        if (logoutBtn) logoutBtn.style.display = "inline-block";
        if (userLabel) userLabel.textContent = `Signed in as ${user.displayName || user.email}`;
        attachLogListener(user.uid);
        showStatus("Logged in successfully.", "success");
      } else {
        if (loginBtn)  loginBtn.style.display = "inline-block";
        if (logoutBtn) logoutBtn.style.display = "none";
        if (userLabel) userLabel.textContent = "";
        unsubscribeLogs?.();
        window.cloudLog = null;
        window.renderLog?.();
      }
    });
  
    // 6) Expose hooks so your script.js can mirror saves/resets
    window.syncLogWriteToday = writeTodayLog;
    window.syncLogDeleteToday = deleteTodayLog;
  })();
  