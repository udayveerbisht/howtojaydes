import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable("x-powered-by");

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

const key = process.env.key;
if (!key) throw new Error('missing env var "key" (create .env with: key=YOUR_GEMINI_KEY)');

const ai = new GoogleGenAI({ apiKey: key });

// model is public → hardcode it
const MODEL = "gemini-3-pro-preview";

const GEN_TIMEOUT_MS = 25000;

// ===== reference =====
function getReferenceText() {
    try {
        return fs.readFileSync(path.join(__dirname, "lyrics.txt"), "utf8").slice(0, 14000);
    } catch (e) {
        console.error("failed to read lyrics.txt:", e?.message || e);
        return "";
    }
}

// ===== helpers =====
const safeStr = (v, maxLen, d = "") => {
    const s = typeof v === "string" ? v : d;
    return s.slice(0, maxLen);
};

function baseBlock() {
    return `
YOU ARE "howtojaydes".
ghost writer trained on jaydes

Output only lyrics.
No titles. No explanations.
`.trim();
}

function buildMakePrompt({ ref, prompt }) {
    return `
${baseBlock()}

Reference:
---
${ref || ""}
---

Prompt:
${prompt}

Write.
`.trim();
}

function buildRewritePrompt({ ref, lyrics, prompt }) {
    return `
${baseBlock()}

Reference:
---
${ref || ""}
---

Lyrics:
---
${lyrics}
---

${prompt ? `Prompt:\n${prompt}\n` : ""}

Rewrite.
`.trim();
}

async function generateText({ prompt, temperature = 0.9, topP = 0.95 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEN_TIMEOUT_MS);

    try {
        const out = await ai.models.generateContent({
            model: MODEL,
            contents: prompt,
            generationConfig: { temperature, topP },
            signal: controller.signal,
        });
        return (out?.text || "").trim();
    } finally {
        clearTimeout(timer);
    }
}

// ===== json-only api + rate limits =====
app.use("/api", (req, res, next) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    next();
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "rate limited" },
});
app.use("/api", apiLimiter);

const genLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "rate limited" },
});

app.get("/api/ref", (req, res) => {
    const ref = getReferenceText();
    res.json({ ok: true, chars: ref.length, preview: ref.slice(0, 1200) });
});

app.all("/api/gen", (req, res, next) => {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "use POST /api/gen" });
    next();
});
app.all("/api/rewrite", (req, res, next) => {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "use POST /api/rewrite" });
    next();
});

// ===== routes =====
app.post("/api/gen", genLimiter, async (req, res) => {
    try {
        const body = req.body || {};
        const promptIn = safeStr(body.prompt, 2000, "").trim();
        if (!promptIn) return res.status(400).json({ ok: false, error: "missing prompt" });

        const ref = getReferenceText();
        if (!ref) return res.status(500).json({ ok: false, error: "missing lyrics.txt" });

        const prompt = buildMakePrompt({ ref, prompt: promptIn });
        const txt = await generateText({ prompt, temperature: 0.95, topP: 0.95 });

        const out = (txt || "").trim();
        if (!out) return res.status(502).json({ ok: false, error: "empty response" });

        res.json({ ok: true, lyrics: out });
    } catch (e) {
        const msg = String(e?.message || e);
        const isAbort = msg.toLowerCase().includes("abort");
        console.error("/api/gen failed:", msg);
        res.status(isAbort ? 504 : 502).json({
            ok: false,
            error: isAbort ? "timed out" : "failed",
            details: msg,
        });
    }
});

app.post("/api/rewrite", genLimiter, async (req, res) => {
    try {
        const body = req.body || {};
        const lyrics = safeStr(body.lyrics, 9000, "").trim();
        const promptIn = safeStr(body.prompt, 2000, "").trim();
        if (!lyrics) return res.status(400).json({ ok: false, error: "missing lyrics" });

        const ref = getReferenceText();
        if (!ref) return res.status(500).json({ ok: false, error: "missing lyrics.txt" });

        const prompt = buildRewritePrompt({ ref, lyrics, prompt: promptIn });
        const txt = await generateText({ prompt, temperature: 0.8, topP: 0.95 });

        const out = (txt || "").trim();
        if (!out) return res.status(502).json({ ok: false, error: "empty response" });

        res.json({ ok: true, lyrics: out });
    } catch (e) {
        const msg = String(e?.message || e);
        const isAbort = msg.toLowerCase().includes("abort");
        console.error("/api/rewrite failed:", msg);
        res.status(isAbort ? 504 : 502).json({
            ok: false,
            error: isAbort ? "timed out" : "failed",
            details: msg,
        });
    }
});

// api 404
app.use("/api", (req, res) => res.status(404).json({ ok: false, error: "not found" }));

// frontend
app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(1010, () => console.log("you have no heart!"));
