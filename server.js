"use strict";

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Story } = require("inkjs");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const port = 3000;

// Set up multer for file upload
const upload = multer({ dest: "uploads/" });

// Function to log memory usage
const logMemoryUsage = () => {
  const used = process.memoryUsage();
  console.log("Memory usage:");
  for (let key in used) {
    console.log(
      `  ${key}: ${Math.round((used[key] / 1024 / 1024) * 100) / 100} MB`
    );
  }
};

const getCurrentPathVisitCount = (story) => {
  const currentPathString = story.state.currentPathString;
  // console.log(currentPathString);
  return story.state.VisitCountAtPathString(currentPathString);
};

let choicesCount = 0;
let choicesOverCount = 0;
let endingsCount = 0;
let maxDepthReached = 0;
let depthReached = 1;

// Function to process JSON content
const recursionDFS = (story) => {
  console.log(story.state.currentPathString);
  console.log(maxDepthReached);
  if (depthReached > 1024) {
    return;
  }
  if (maxDepthReached < depthReached) {
    maxDepthReached = depthReached;
  }

  if (getCurrentPathVisitCount(story)) {
    console.log("already visited");
    return;
  }

  let loop = 0;
  while (story.canContinue) {
    let line = story.Continue();

    // console.log(line);
    // console.log(story.state.currentPathString);
    if (loop++ >= 200) {
      choicesOverCount++;
      console.log("over max choices");
      return;
    }
  }
  const backUpJson = story.state.toJson();
  for (let i = 0; i < story.currentChoices.length; i++) {
    choicesCount++;
    let choice = story.currentChoices[i];
    story.ChooseChoiceIndex(choice.index);

    // if (depthReached >= 32) {
    //   depthReached--;
    //   story.state.LoadJson(backUpJson);
    //   break;
    // }
    depthReached++;
    recursionDFS(story);
    depthReached--;

    story.state.LoadJson(backUpJson);
  }
  if (story.currentChoices.length == 0) {
    endingsCount++;
    // logMemoryUsage();
  }
};

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// API to upload a JSON file
app.post("/upload", upload.single("file"), (req, res) => {
  choicesCount = 0;
  choicesOverCount = 0;
  endingsCount = 0;
  maxDepthReached = 0;
  depthReached = 1;

  const filePath = path.join(__dirname, req.file.path);

  // Read the JSON file
  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      console.error("Error reading file:", err);
      return res.status(500).send("Error reading file");
    }

    // Parse the JSON content
    try {
      const inkJson = JSON.parse(data.replace(/^\uFEFF/, ""));
      const story = new Story(inkJson);
      console.time("dfsTraversal");
      recursionDFS(story);
      console.timeEnd("dfsTraversal");

      // res.send("File processed successfully");

      res.send(
        `choicesCount: ${choicesCount}, choicesOverCount: ${choicesOverCount}, endingsCount: ${endingsCount}, maxDepthReached: ${maxDepthReached}`
      );
    } catch (parseErr) {
      console.error("Error parsing JSON:", parseErr);
      res.status(400).send("Invalid JSON format");
    } finally {
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error("Error deleting file:", unlinkErr);
        }
      });
    }
  });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
