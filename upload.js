const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Story } = require("inkjs");
const util = require("util");

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const logMemoryUsage = () => {
  const used = process.memoryUsage();
  console.log("Memory usage:");
  for (let key in used) {
    console.log(
      `  ${key}: ${Math.round((used[key] / 1024 / 1024) * 100) / 100} MB`
    );
  }
};

const recursionDFS = (story) => {
  while (story.canContinue) {
    const line = story.Continue();
    const backUpJson = story.state.toJson();

    for (let i = 0; i < story.currentChoices.length; i++) {
      let choice = story.currentChoices[i];
      story.ChooseChoiceIndex(choice.index);
      recursionDFS(story);
      logMemoryUsage();
      story.state.LoadJson(backUpJson);
    }
  }
};

module.exports = (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      console.error("Error uploading file:", err);
      return res.status(500).send("Error uploading file");
    }

    try {
      const inkJson = JSON.parse(
        req.file.buffer.toString("utf8").replace(/^\uFEFF/, "")
      );
      const story = new Story(inkJson);
      recursionDFS(story);

      res.send("File processed successfully");
    } catch (parseErr) {
      console.error("Error parsing JSON:", parseErr);
      res.status(400).send("Invalid JSON format");
    }
  });
};
