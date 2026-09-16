import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";

const tmp = path.join(process.cwd(), "tmp_uploads");
fs.mkdirSync(tmp, { recursive: true });

const upload = multer({
  dest: tmp,
  limits: { files: 20, fileSize: 50 * 1024 * 1024 }
});

const key = process.env.OPENAI_API_KEY;
const client = key ? new OpenAI({ apiKey: key }) : null;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_, res) =>
  res.json({
    ok: true,
    aiConfigured: Boolean(key),
    model: MODEL
  })
);

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          subject: { type: "string" },
          year: { type: "string" },
          paper: { type: "string" },
          questionNumber: { type: "string" },
          question: { type: "string" },
          marks: { type: "number" },
          type: { type: "string" },
          chapter: { type: "string" },
          topic: { type: "string" },
          answer: { type: "string" },
          points: {
            type: "array",
            items: { type: "string" }
          },
          confidence: { type: "number" },
          sourceFile: { type: "string" }
        },
        required: [
          "subject",
          "year",
          "paper",
          "questionNumber",
          "question",
          "marks",
          "type",
          "chapter",
          "topic",
          "answer",
          "points",
          "confidence",
          "sourceFile"
        ]
      }
    },
    repeatedGroups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          canonicalQuestion: { type: "string" },
          questionNumbers: {
            type: "array",
            items: { type: "string" }
          },
          years: {
            type: "array",
            items: { type: "string" }
          },
          papers: {
            type: "array",
            items: { type: "string" }
          },
          similarityReason: { type: "string" }
        },
        required: [
          "canonicalQuestion",
          "questionNumbers",
          "years",
          "papers",
          "similarityReason"
        ]
      }
    }
  },
  required: ["questions", "repeatedGroups"]
};

const SYSTEM = `
You are the RAJUVAS veterinary PYQ ingestion engine.

Extract EVERY distinct exam question from the source.

Separate questions from answers even when answers are paragraphs,
bullets, tables, or follow Answer/Ans/Solution labels.

Never invent a missing answer.

Convert paragraph answers into concise numbered exam points
without changing scientific meaning.

Detect year and Paper I/Paper II.

Detect marks.

Classify question type.

Map questions to the closest veterinary chapter and topic.

Group semantically repeated questions across years and papers.

Preserve veterinary terminology and disease names.

Confidence must be between 0 and 1.
`;

function buildPrompt(meta, text, file) {
  return `${SYSTEM}

Source file: ${file}

Subject hint: ${meta.subjectHint || "Auto"}
Paper hint: ${meta.paperHint || "Auto"}
Year hint: ${meta.yearHint || "Auto"}
Marks hint: ${meta.marksHint || "Auto"}
Chapter hint: ${meta.chapterHint || "Auto"}

Return structured JSON only.

SOURCE:
${text}`;
}

async function readFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === ".pdf") {
    const data = await pdfParse(fs.readFileSync(file.path));
    return data.text || "";
  }

  if (ext === ".docx") {
    const data = await mammoth.extractRawText({
      path: file.path
    });
    return data.value || "";
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.readFile(file.path);

    return workbook.SheetNames
      .map(name =>
        `--- ${name} ---\n` +
        XLSX.utils.sheet_to_csv(workbook.Sheets[name])
      )
      .join("\n");
  }

  return fs.readFileSync(file.path, "utf8");
}

async function analyzeText(text, meta, fileName) {
  if (!client) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await client.responses.create({
    model: MODEL,

    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: SYSTEM
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildPrompt(meta, text, fileName)
          }
        ]
      }
    ],

    text: {
      format: {
        type: "json_schema",
        name: "rajuvas_pyq_result",
        strict: true,
        schema
      }
    }
  });

  return JSON.parse(response.output_text);
}

app.post(
  "/api/analyze-pyq",
  upload.array("files", 20),
  async (req, res) => {

    const files = req.files || [];

    const meta = {
      subjectHint: req.body.subjectHint,
      paperHint: req.body.paperHint,
      yearHint: req.body.yearHint,
      marksHint: req.body.marksHint,
      chapterHint: req.body.chapterHint
    };

    if (
      !files.length &&
      !String(req.body.text || "").trim()
    ) {
      return res.status(400).json({
        error: "No files or pasted text received."
      });
    }

    try {
      const questions = [];
      const repeatedGroups = [];

      for (const file of files) {

        const text = await readFile(file);

        const result = await analyzeText(
          text,
          meta,
          file.originalname
       
