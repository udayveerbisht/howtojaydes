const $ = (id) => document.getElementById(id);

const out = $("out");
const copyBtn = $("btn_copy");

const tabGen = $("tab_gen");
const tabRewrite = $("tab_rewrite");

const panelGen = $("panel_gen");
const panelRewrite = $("panel_rewrite");

const promptGen = $("prompt_gen");
const btnGenerate = $("btn_generate");
const btnCancel = $("btn_cancel");
const status = $("status");

const lyricsIn = $("lyrics_in");
const promptRewrite = $("prompt_rewrite");
const btnRewrite = $("btn_rewrite");
const btnCancel2 = $("btn_cancel_2");
const status2 = $("status2");

let activeController = null;
let mode = "gen";

function setTab(which) {
    mode = which;

    panelGen.classList.toggle("hidden", which !== "gen");
    panelRewrite.classList.toggle("hidden", which !== "rewrite");

    const on = "bg-white/10";
    const off = "text-white/70 hover:text-white";

    [tabGen, tabRewrite].forEach((b) => {
        b.classList.remove("bg-white/10");
        b.classList.add("text-white/70");
    });

    if (which === "gen") {
        tabGen.classList.add(on);
        tabGen.classList.remove("text-white/70");
        tabGen.classList.remove("hover:text-white");
    } else tabGen.classList.add(off);

    if (which === "rewrite") {
        tabRewrite.classList.add(on);
        tabRewrite.classList.remove("text-white/70");
        tabRewrite.classList.remove("hover:text-white");
    } else tabRewrite.classList.add(off);

    status.textContent = "";
    status2.textContent = "";
}

function setBusy(busy) {
    btnGenerate.disabled = busy;
    btnCancel.classList.toggle("hidden", !busy);

    btnRewrite.disabled = busy;
    btnCancel2.classList.toggle("hidden", !busy);
}

async function safeJsonFetch(url, options) {
    const r = await fetch(url, options);
    const ct = r.headers.get("content-type") || "";
    const text = await r.text();

    if (!ct.includes("application/json")) throw new Error(`non-json response (${r.status})`);
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error("bad json");
    }
    if (!r.ok || data?.ok === false) throw new Error(data?.details || data?.error || "request failed");
    return data;
}

function setOutput(text) {
    out.textContent = (text || "").trim();
}

function cancelActive() {
    if (activeController) {
        activeController.abort();
        activeController = null;
    }
    setBusy(false);
    if (mode === "gen") status.textContent = "cancelled";
    if (mode === "rewrite") status2.textContent = "cancelled";
}

btnCancel.addEventListener("click", cancelActive);
btnCancel2.addEventListener("click", cancelActive);

tabGen.addEventListener("click", () => setTab("gen"));
tabRewrite.addEventListener("click", () => setTab("rewrite"));

copyBtn.addEventListener("click", async () => {
    const text = (out.textContent || "").trim();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = "copied";
    setTimeout(() => (copyBtn.textContent = "copy"), 900);
});

btnGenerate.addEventListener("click", async () => {
    const prompt = (promptGen.value || "").trim();
    if (!prompt) return (status.textContent = "type a prompt");

    if (activeController) activeController.abort();
    activeController = new AbortController();

    setBusy(true);
    status.textContent = "working...";
    setOutput("");

    try {
        const data = await safeJsonFetch("/api/gen", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
            signal: activeController.signal,
        });
        setOutput(String(data.lyrics || ""));
        status.textContent = "";
    } catch (err) {
        const msg = String(err?.message || err).toLowerCase();
        status.textContent = msg.includes("abort") ? "cancelled" : `error: ${msg}`;
    } finally {
        activeController = null;
        setBusy(false);
    }
});

btnRewrite.addEventListener("click", async () => {
    const lyrics = (lyricsIn.value || "").trim();
    const prompt = (promptRewrite.value || "").trim();
    if (!lyrics) return (status2.textContent = "paste lyrics");

    if (activeController) activeController.abort();
    activeController = new AbortController();

    setBusy(true);
    status2.textContent = "working...";
    setOutput("");

    try {
        const data = await safeJsonFetch("/api/rewrite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lyrics, prompt }),
            signal: activeController.signal,
        });
        setOutput(String(data.lyrics || ""));
        status2.textContent = "";
    } catch (err) {
        const msg = String(err?.message || err).toLowerCase();
        status2.textContent = msg.includes("abort") ? "cancelled" : `error: ${msg}`;
    } finally {
        activeController = null;
        setBusy(false);
    }
});

setTab("gen");
setBusy(false);
