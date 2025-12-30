const $ = (id) => document.getElementById(id);

const outText = $("out_text");
const outMd = $("out_md");
const copyBtn = $("btn_copy");

const tabGen = $("tab_gen");
const tabRewrite = $("tab_rewrite");
const tabUse = $("tab_use");

const panelGen = $("panel_gen");
const panelRewrite = $("panel_rewrite");
const panelUse = $("panel_use");

const promptGen = $("prompt_gen");
const btnGenerate = $("btn_generate");
const btnCancel = $("btn_cancel");
const status = $("status");

const lyricsIn = $("lyrics_in");
const promptRewrite = $("prompt_rewrite");
const btnRewrite = $("btn_rewrite");
const btnCancel2 = $("btn_cancel_2");
const status2 = $("status2");

const lyricsUse = $("lyrics_use");
const promptUse = $("prompt_use");
const btnUse = $("btn_use");
const btnCancel3 = $("btn_cancel_3");
const status3 = $("status3");

let activeController = null;
let mode = "gen";
let lastOutputPlain = "";

function setTab(which) {
    mode = which;

    panelGen.classList.toggle("hidden", which !== "gen");
    panelRewrite.classList.toggle("hidden", which !== "rewrite");
    panelUse.classList.toggle("hidden", which !== "use");

    const on = "bg-white/10";
    const off = "text-white/70 hover:text-white";

    [tabGen, tabRewrite, tabUse].forEach((b) => {
        b.classList.remove("bg-white/10");
        b.classList.add("text-white/70");
        b.classList.add("hover:text-white");
    });

    if (which === "gen") {
        tabGen.classList.add(on);
        tabGen.classList.remove("text-white/70");
        tabGen.classList.remove("hover:text-white");
    }

    if (which === "rewrite") {
        tabRewrite.classList.add(on);
        tabRewrite.classList.remove("text-white/70");
        tabRewrite.classList.remove("hover:text-white");
    }

    if (which === "use") {
        tabUse.classList.add(on);
        tabUse.classList.remove("text-white/70");
        tabUse.classList.remove("hover:text-white");
    }

    status.textContent = "";
    status2.textContent = "";
    status3.textContent = "";
}

function setBusy(busy) {
    btnGenerate.disabled = busy;
    btnCancel.classList.toggle("hidden", !busy);

    btnRewrite.disabled = busy;
    btnCancel2.classList.toggle("hidden", !busy);

    btnUse.disabled = busy;
    btnCancel3.classList.toggle("hidden", !busy);
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

function setOutputPlain(text) {
    const t = (text || "").trim();
    lastOutputPlain = t;
    outText.textContent = t;
    outText.classList.remove("hidden");
    outMd.classList.add("hidden");
}

function setOutputMarkdown(md) {
    const src = (md || "").trim();
    lastOutputPlain = src;
    const html = window.marked.parse(src, { breaks: true, gfm: true });
    const clean = window.DOMPurify.sanitize(html);
    outMd.innerHTML = clean;
    outMd.classList.remove("hidden");
    outText.classList.add("hidden");
}

function cancelActive() {
    if (activeController) {
        activeController.abort();
        activeController = null;
    }
    setBusy(false);
    if (mode === "gen") status.textContent = "cancelled";
    if (mode === "rewrite") status2.textContent = "cancelled";
    if (mode === "use") status3.textContent = "cancelled";
}

btnCancel.addEventListener("click", cancelActive);
btnCancel2.addEventListener("click", cancelActive);
btnCancel3.addEventListener("click", cancelActive);

tabGen.addEventListener("click", () => setTab("gen"));
tabRewrite.addEventListener("click", () => setTab("rewrite"));
tabUse.addEventListener("click", () => setTab("use"));

copyBtn.addEventListener("click", async () => {
    const text = (lastOutputPlain || "").trim();
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
    setOutputPlain("");

    try {
        const data = await safeJsonFetch("/api/gen", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
            signal: activeController.signal,
        });
        setOutputPlain(String(data.lyrics || ""));
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
    setOutputPlain("");

    try {
        const data = await safeJsonFetch("/api/rewrite", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lyrics, prompt }),
            signal: activeController.signal,
        });
        setOutputPlain(String(data.lyrics || ""));
        status2.textContent = "";
    } catch (err) {
        const msg = String(err?.message || err).toLowerCase();
        status2.textContent = msg.includes("abort") ? "cancelled" : `error: ${msg}`;
    } finally {
        activeController = null;
        setBusy(false);
    }
});

btnUse.addEventListener("click", async () => {
    const lyrics = (lyricsUse.value || "").trim();
    const prompt = (promptUse.value || "").trim();
    if (!lyrics) return (status3.textContent = "paste lyrics");

    if (activeController) activeController.abort();
    activeController = new AbortController();

    setBusy(true);
    status3.textContent = "working...";
    setOutputPlain("");

    try {
        const data = await safeJsonFetch("/api/use", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lyrics, prompt }),
            signal: activeController.signal,
        });
        setOutputMarkdown(String(data.markdown || ""));
        status3.textContent = "";
    } catch (err) {
        const msg = String(err?.message || err).toLowerCase();
        status3.textContent = msg.includes("abort") ? "cancelled" : `error: ${msg}`;
    } finally {
        activeController = null;
        setBusy(false);
    }
});

setTab("gen");
setBusy(false);
setOutputPlain("");
