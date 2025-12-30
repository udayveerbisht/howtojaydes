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
const MODEL = "gemini-3-pro-preview";
const GEN_TIMEOUT_MS = 25000;

const REFERENCE_CLEANING_RULES = `
REFERENCE SANITIZATION (VERY IMPORTANT):
The reference text may contain NON-LYRICS and even NON-JAYDES content because it was scraped/compiled.
Before learning the voice, you MUST FILTER the reference internally.

Treat the reference as a noisy dataset:
- Keep only lines that are plausibly lyrics in a single consistent voice.
- Ignore any site/navigation/metadata content, headings, separators, or other-artist content.

Hard ignore any lines/blocks that include ANY of these patterns (case-insensitive):
- "http", "https", "www.", "URL:"
- "azlyrics", "random lyrics", "hot lyrics", "last update"
- "contact", "privacy", "policy", "sitemap", "rss", "facebook"
- "submit / correct", "submit", "correct", "search", "loading"
- ad-ish words: "adunit", "clickfuse", "amplified", "showads", "banner", "sponsored"
- obvious separators/labels: "=====", "TITLE:", "ARTIST:", "SONG:", "From:", "Produced by", "Embed", "You might also like"

Also ignore blocks that:
- are mostly links or look like menus/lists of artists/songs
- look like paragraphs of prose about the artist/song (descriptions, bios, disclaimers)
- have lots of punctuation like HTML remnants or repeated UI words

If the reference contains multiple voices/artists:
- Build the "jaydes" fingerprint ONLY from the dominant voice that repeats most.
- Discard outliers that do not match that dominant voice fingerprint.

Never copy junk text into output.
Never imitate website tone.
`.trim();

const AI_PROMPT_PROCESSING = `
You are writing lyrics for a fictional persona named "jaydes".
The ONLY canon is the provided reference text AFTER filtering.

Goal: produce lyrics that read like the same author as the filtered reference.
Not "similar vibes" — lock to the filtered reference's actual habits.

How to use the reference (process before writing):
A) Build a private "voice fingerprint" from the filtered reference:
   1) Lexicon map:
      - list the common words, filler words, slang, and connective phrases that keep repeating
      - list the kinds of words that almost never appear (overly poetic, academic, corporate, motivational)
   2) Sentence shape:
      - fragments vs full sentences
      - how often it uses "i/you/we", tense, and pronoun switching
      - how direct or indirect the statements are
   3) Punctuation + casing:
      - capitalization habits
      - typical punctuation (or lack of it)
      - whether lines end clean or cut off
   4) Cadence + line mechanics:
      - typical line length range
      - how often it stacks short lines vs long run-ons
      - how it places emphasis words (end of line, mid-line, repeats)
   5) Rhyme + sound:
      - end rhyme frequency, internal rhyme frequency
      - does it prefer perfect rhymes, near rhymes, repeated vowels, repeated consonants
      - how often it repeats the same end sound for multiple lines
   6) Motifs + worldview:
      - recurring objects, environments, emotions, relationship dynamics
      - how it handles flex/vulnerability, anger/softness, distance/closeness
      - what it avoids talking about

B) While drafting, run a strict "would jaydes say this?" filter:
   - every line must feel inevitable in this voice
   - if a word/phrase feels generic or "writer-y", replace it with a reference-style alternative
   - avoid metaphors and phrases that don't match the reference's normal imagery
   - avoid cleverness that isn't present in the reference

C) Avoid off-voice contamination:
   - do not introduce new catchphrases, new ad-lib style, or new comedic tone unless the filtered reference already has it
   - do not add brand names, places, pop culture, or trending phrases unless the filtered reference already uses that category of detail
   - do not suddenly become cleaner, more polished, or more complex than the filtered reference

D) Originality constraint:
   - do NOT copy full lines from the filtered reference
   - you may reuse micro-patterns (1–3 words) only if they are clearly common speech habits in the filtered reference
   - everything should be newly written, but structurally indistinguishable from the filtered reference author

E) Output rules:
   - output ONLY lyrics
   - no titles, no labels, no notes, no explanations
   - clean line breaks
`.trim();

function getReferenceText() {
  try {
    return fs.readFileSync(path.join(__dirname, "lyrics.txt"), "utf8").slice(0, 14000);
  } catch (e) {
    console.error("failed to read lyrics.txt:", e?.message || e);
    return "";
  }
}

const safeStr = (v, maxLen, d = "") => {
  const s = typeof v === "string" ? v : d;
  return s.slice(0, maxLen);
};

function baseBlock() {
  return `
${REFERENCE_CLEANING_RULES}

${AI_PROMPT_PROCESSING}

YOU ARE "howtojaydes".
ghost writer trained on jaydes

Output only lyrics.
No titles. No explanations.
`.trim();
}

function buildMakePrompt({ ref, prompt }) {
  return `
${baseBlock()}

REFERENCE (noisy; filter it first):
---
${ref || ""}
---

USER PROMPT:
${prompt}

Write now.
`.trim();
}

function buildRewritePrompt({ ref, lyrics, prompt }) {
  return `
${baseBlock()}

REFERENCE (noisy; filter it first):
---
${ref || ""}
---

USER LYRICS:
---
${lyrics}
---

${prompt ? `USER PROMPT:\n${prompt}\n` : ""}

Rewrite in jaydes' exact voice while keeping the same meaning and structure.
Output only rewritten lyrics.
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

app.use("/api", (req, res) => res.status(404).json({ ok: false, error: "not found" }));

app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(1010, () => console.log("you have no heart!"));
