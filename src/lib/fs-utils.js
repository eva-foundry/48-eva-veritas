// EVA-STORY: EO-06-002
// EVA-FEATURE: EO-06
"use strict";

const fs = require("fs");
const path = require("path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

function writeJson(filePath, obj) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return null;
  }
}

function rel(repoPath, absPath) {
  return path.relative(repoPath, absPath).replace(/\\/g, "/");
}

module.exports = {
  ensureDir,
  readTextIfExists,
  writeJson,
  readJsonIfExists,
  rel
};
