const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Story } = require("inkjs");
const cors = require("cors");
const readline = require("readline");
const crypto = require("crypto");

console.log("Reading JSON file...");

const inkJson = JSON.parse(
  fs
    .readFileSync(
      "./data/JSON_Story_Files_01/BackToSecretAgentSchool20.json",
      "utf-8"
    )
    .replace(/^\uFEFF/, "")
);

console.log("Creating Story instance...");
const story = new Story(inkJson);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const prompt = () => {
  return new Promise((resolve, reject) => {
    rl.question("?> ", (answer) => {
      resolve(answer);
    });
  });
};

const play = async () => {
  console.log("Starting game loop...");
  do {
    while (story.canContinue) {
      const text = story.Continue();
      process.stdout.write(text);
      if (story.currentTags && story.currentTags.length) {
        process.stdout.write(" # tags: " + story.currentTags.join(", ") + "\n");
      }
    }
    process.stdout.write("\n");

    if (story.currentChoices.length == 0) {
      console.log("No more choices available. Exiting...");
      return;
    }

    for (let i = 0; i < story.currentChoices.length; ++i) {
      const choice = story.currentChoices[i];
      process.stdout.write(`${i + 1}: ${choice.text}`);
      process.stdout.write("\n");
    }
    process.stdout.write("?> ");
    do {
      const answer = await prompt();
      const choiceIndex = parseInt(answer) - 1;
      try {
        story.ChooseChoiceIndex(choiceIndex);
        break;
      } catch (e) {
        if (e instanceof Error) {
          console.error("Error:", e.message);
          process.stdout.write(e.message + "\n");
        }
      }
    } while (true);
  } while (true);
};

play().then(() => {
  console.log("DONE.");
  rl.close();
  process.exit(0);
});
