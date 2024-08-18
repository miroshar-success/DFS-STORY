"use strict";

const fs = require("fs");
const { Story } = require("inkjs");
const winston = require("winston");
const readlineSync = require("readline-sync");
const crypto = require("crypto");
const util = require("util");
const path = require("path");
const PathDatabase = require("./pathDatabase");

const path_db_path = temp_db_path();
const path_db = new PathDatabase(path_db_path);

const storyFilePath = "data/Story_TheIntercept.json";
const outputFilePrefix = "progress";

function temp_db_path() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:]/g, "-")
    .replace(/[T]/g, "_")
    .split(".")[0];
  return `temp/sqlite3_${timestamp}.db`;
}

const uniquePrefix = generateUniquePrefix(storyFilePath);
const continueArg = process.argv.find((arg) => arg.startsWith("--continue="));
const BATCH_SIZE = continueArg ? parseInt(continueArg.split("=")[1]) : 20000;
const CONTINUE_INTERVAL = 10000000;

const inkJson = JSON.parse(
  fs.readFileSync(storyFilePath, "utf-8").replace(/^\uFEFF/, "")
);
const story = new Story(inkJson);

let visitedStates = new Set();
const pathStack = [];
let endingCounts = new Map();
let stateCounter = 0;
let choicesCount = 0;
let endingsCount = 0;
const allErrors = [];
let totalErrors = 0;
let fileCounter = 0;
let batchCounter = 0;
const MEMORY_LIMIT = 26 * 1024 * 1024 * 1024;
let lastMadeChoice = null;
let truePath = [];

const MAX_DEPTH = 200;
let maxDepthReached = 0;
let maxDepthAborts = 0;
const LOOP_THRESHOLD = 3;
const MAX_OBJECTS_PER_PATH = 1000;

let maxObjectsBetweenChoices = 0;
const MAX_OBJECTS_BETWEEN_CHOICES = 1000;

const knotsExceedingMaxObjects = new Set();
const knotErrorTypes = new Map();
let lastKnownKnot = story.state.currentPathString.split(".")[0];

const logger = winston.createLogger({
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    progress: 3,
    ending: 4,
    verbose: 5,
    debug: 6,
    silly: 7,
  },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    new winston.transports.File({
      filename: `${uniquePrefix}_log.txt`,
      level: "ending",
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
      level: "error",
    }),
  ],
});

const getStateHash = (stateJson) =>
  crypto.createHash("sha1").update(stateJson).digest("hex");

const getCurrentEndingDetail = () => {
  const lastLine = story.currentText.trim();
  const currentKnot =
    story.state.currentPathString || lastKnownKnot || "Unknown";
  return {
    knot: currentKnot,
    lastLine: lastLine || "",
  };
};

const handleError = (message, type, truePath, lastChoice) => {
  const currentKnot = lastKnownKnot;
  const errorKey = `${currentKnot}:${type}`;

  if (!knotErrorTypes.has(errorKey)) {
    knotErrorTypes.set(errorKey, true);

    const errorDetail = {
      message,
      type,
      knot: currentKnot,
      path: [...truePath],
      lastChoice: lastChoice ? lastChoice.text : "No choices made",
      stateBefore: lastChoice ? lastChoice.stateBefore : null,
      stateAfter: lastChoice ? lastChoice.stateAfter : null,
      timestamp: new Date().toISOString(),
    };

    allErrors.push(errorDetail);
    totalErrors++;
    logger.error(`Error (${type}): ${message} at ${currentKnot}`);
    logger.error(`Last Choice: ${errorDetail.lastChoice}`);
    logger.error(`Current Path: ${truePath.join(" -> ")}`);
    logMemoryUsage();
  }
};

story.onError = (message, type) => {
  handleError(message, type, truePath, lastMadeChoice);
};

const displayProgress = () => {
  console.clear();
  console.log(`Choices processed: ${choicesCount}`);
  console.log(`Endings reached: ${endingsCount}`);
  console.log(`Errors encountered: ${totalErrors}`);
  console.log(
    `Current path depth: ${
      pathStack.length > 0 ? pathStack[pathStack.length - 1].depth : 0
    }`
  );
  console.log(`Max depth reached: ${maxDepthReached}`);
  console.log(`Paths aborted due to max depth: ${maxDepthAborts}`);
  console.log(`Max objects between choices: ${maxObjectsBetweenChoices}`);
  logMemoryUsage();
};

const logMemoryUsage = () => {
  const used = process.memoryUsage();
  console.log("Memory usage:");
  for (let key in used) {
    console.log(
      `  ${key}: ${Math.round((used[key] / 1024 / 1024) * 100) / 100} MB`
    );
  }
  console.log(`  endingCounts size: ${endingCounts.size}`);
  console.log(`  visitedStates size: ${visitedStates.size}`);
  console.log(`  pathStack length: ${pathStack.length}`);
  console.log(`  allErrors length: ${allErrors.length}`);
  console.log(`  Max objects between choices: ${maxObjectsBetweenChoices}`);
};

const writeCheckpoint = (counter) => {
  const progressData = {
    endingCounts: Array.from(endingCounts.entries()),
    stateCounter,
    choicesCount,
    endingsCount,
    allErrors,
    maxDepthReached,
    maxDepthAborts,
    maxObjectsBetweenChoices,
  };
  const fileName = `${uniquePrefix}_checkpoint_${counter}.json`;
  fs.writeFileSync(fileName, JSON.stringify(progressData, null, 2));
  logger.info(`Checkpoint written to ${fileName}`);
  endingCounts.clear();
  visitedStates.clear();
  maxObjectsBetweenChoices = 0;
  if (global.gc) {
    global.gc();
  }
};

const askToContinue = () => {
  displayProgress();
  const response = readlineSync.question("Do you want to continue? (yes/no): ");
  if (response.trim().toLowerCase() !== "yes") {
    console.log("Process stopped by user.");
    writeFinalReport();
    process.exit(0);
  }
  return true;
};

const cleanUpTempFiles = () => {
  for (let i = 0; i < fileCounter - 1; i++) {
    const fileName = `${uniquePrefix}_checkpoint_${i}.json`;
    if (fs.existsSync(fileName)) {
      fs.unlinkSync(fileName);
      logger.info(`Temporary file ${fileName} deleted.`);
    }
  }
};

const monitorMemoryUsage = (counter) => {
  const used = process.memoryUsage().heapUsed;
  if (
    used > MEMORY_LIMIT ||
    maxObjectsBetweenChoices > MAX_OBJECTS_BETWEEN_CHOICES
  ) {
    console.log(
      `Memory usage exceeded ${
        MEMORY_LIMIT / (1024 * 1024)
      } MB or max objects between choices (${maxObjectsBetweenChoices}) exceeded threshold. Writing checkpoint and clearing memory.`
    );
    writeCheckpoint(counter);
    maxObjectsBetweenChoices = 0;
  }
};

const clearKnotsExceedingMaxObjects = () => {
  knotsExceedingMaxObjects.clear();
  knotErrorTypes.clear();
};

const processChoices = (stateJson, path, depth, stateRepetitions) => {
  if (depth > maxDepthReached) {
    maxDepthReached = depth;
  }

  if (depth >= MAX_DEPTH) {
    maxDepthAborts++;
    return;
  }

  story.state.LoadJson(JSON.parse(stateJson));
  const currentKnot = story.state.currentPathString.split(".")[0];
  lastKnownKnot = currentKnot;

  const stateKey = getStateHash(stateJson);
  if (visitedStates.has(stateKey)) {
    return;
  }
  visitedStates.add(stateKey);

  const currentRepetitions = stateRepetitions.get(stateKey) || 0;
  if (currentRepetitions >= LOOP_THRESHOLD) {
    handleError(
      "Detected loop without choices",
      "Runtime",
      path,
      lastMadeChoice
    );
    return;
  }
  stateRepetitions.set(stateKey, currentRepetitions + 1);

  let objectsBetweenChoices = 0;

  if (story.canContinue) {
    try {
      while (story.canContinue) {
        story.Continue();
        objectsBetweenChoices++;

        maxObjectsBetweenChoices = Math.max(
          maxObjectsBetweenChoices,
          objectsBetweenChoices
        );

        if (objectsBetweenChoices >= MAX_OBJECTS_BETWEEN_CHOICES) {
          handleError(
            "Exceeded maximum number of objects between choices",
            "Runtime",
            path,
            lastMadeChoice
          );
          return;
        }
      }
    } catch (error) {
      handleError(error.message, "Runtime", path, lastMadeChoice);
      return;
    }
  }

  if (story.currentChoices.length === 0) {
    const endingDetail = getCurrentEndingDetail();
    endingCounts.set(stateKey, (endingCounts.get(stateKey) || 0) + 1);
    endingsCount++;
    logger.ending(
      `Reached an ending: ${JSON.stringify(endingDetail)} at depth ${depth}`
    );
    return;
  }

  for (const choice of story.currentChoices) {
    const stateBefore = JSON.stringify(story.state.toJson());
    story.ChooseChoiceIndex(choice.index);
    const stateAfter = JSON.stringify(story.state.toJson());
    lastMadeChoice = {
      text: choice.text,
      stateBefore,
      stateAfter,
    };
    if (!visitedStates.has(getStateHash(stateAfter))) {
      pathStack.push({
        stateJson: stateAfter,
        path: path.concat(choice.text),
        depth: depth + 1,
      });
      if (pathStack.length >= 10000) {
        path_db.insertPaths(pathStack);
        pathStack.clear();
      }
    } else {
      console.log("**************************************************");
    }
    story.state.LoadJson(JSON.parse(stateBefore));
  }
};

const pushStack_can_continue = () => {
  if (pathStack.length > 0) {
    return true;
  }
  return !!path_db.getSize();
};

const pushStack_pop = () => {
  if (pathStack.length > 0) {
    return pathStack.pop();
  }
  let lastPaths = path_db.getLastPaths(10000);
  const idsToDelete = lastPaths.map((row) => row.id);
  path_db.deletePathsByIds(idsToDelete);
  pathStack = lastPaths.map((e) => JSON.parse(e)).reverse();

  return pathStack.pop();
};

const dfsTraversal = async () => {
  let batchCounter = 0;

  while (pushStack_can_continue()) {
    const { stateJson, path, depth } = pushStack_pop();

    choicesCount++;
    truePath = path;

    let stateRepetitions = new Map();

    try {
      processChoices(stateJson, path, depth, stateRepetitions);
    } catch (error) {
      handleError(error.message, "Unexpected", truePath, lastMadeChoice);
      console.error("Unexpected error:", error);
      console.error(
        "Current state:",
        util.inspect(JSON.parse(stateJson), { depth: null })
      );
      await writeFinalReport();
      process.exit(1);
    }

    if (++batchCounter >= BATCH_SIZE) {
      writeCheckpoint(fileCounter++);
      clearKnotsExceedingMaxObjects();
      batchCounter = 0;
      displayProgress();
    }

    if (choicesCount % 10000 === 0) {
      console.log(`Processed ${choicesCount} choices. Current depth: ${depth}`);
    }

    if (endingsCount % CONTINUE_INTERVAL === 0 && endingsCount > 0) {
      askToContinue();
    }
  }

  await writeFinalReport();
};

const writeFinalReportAndCloseLogger = async () => {
  await writeFinalReport();
  await finalize();
};

const writeFinalReport = async () => {
  const consolidatedData = consolidateProgress();
  const mostReachedEnding = [...consolidatedData.endingCounts.entries()].reduce(
    (a, b) => (a[1] > b[1] ? a : b),
    [null, 0]
  );
  const leastReachedEnding = [
    ...consolidatedData.endingCounts.entries(),
  ].reduce((a, b) => (a[1] < b[1] ? a : b), [null, Infinity]);

  console.clear();
  console.log(`Total choices processed: ${choicesCount}`);
  console.log(`Total endings reached: ${endingsCount}`);
  console.log(`Total errors encountered: ${totalErrors}`);
  console.log(`Max depth reached: ${maxDepthReached}`);
  console.log(`Paths aborted due to max depth: ${maxDepthAborts}`);
  console.log(
    `Max objects between choices: ${consolidatedData.maxObjectsBetweenChoices}`
  );

  if (mostReachedEnding[0]) {
    const mostDetail = consolidatedData.endingDetails.get(mostReachedEnding[0]);
    console.log(
      `Most reached ending: Knot = ${
        mostDetail ? mostDetail.knot : "Unknown"
      }, Last line = "${
        mostDetail ? mostDetail.lastLine : "Unknown"
      }" (Reached ${mostReachedEnding[1]} times)`
    );
  }
  if (leastReachedEnding[0]) {
    const leastDetail = consolidatedData.endingDetails.get(
      leastReachedEnding[0]
    );
    console.log(
      `Least reached ending: Knot = ${
        leastDetail ? leastDetail.knot : "Unknown"
      }, Last line = "${
        leastDetail ? leastDetail.lastLine : "Unknown"
      }" (Reached ${leastReachedEnding[1]} times)`
    );
  }

  if (consolidatedData.errors.length > 0) {
    console.log("\nErrors encountered:");
    consolidatedData.errors.forEach((error, index) => {
      console.log(
        `Error ${index + 1}: (${error.type}) ${error.message} at knot ${
          error.knot
        }`
      );
      console.log(`Path: ${error.path.join(" -> ")}`);
      console.log(`Last Choice: ${error.lastChoice}`);
      console.log(`State Before: ${error.stateBefore}`);
      console.log(`State After: ${error.stateAfter}`);
      console.log("---");
    });
  }

  console.log("Script execution completed.");
};

const finalize = async () => {
  cleanUpTempFiles();
  await closeLogger();
};

const consolidateProgress = () => {
  let consolidatedData = {
    endingCounts: new Map(),
    endingDetails: new Map(),
    errors: [...allErrors],
    maxDepthReached: maxDepthReached,
    maxDepthAborts: maxDepthAborts,
    maxObjectsBetweenChoices: maxObjectsBetweenChoices,
  };

  for (let i = 0; i < fileCounter; i++) {
    const fileName = `log/${uniquePrefix}_checkpoint_${i}.json`;
    if (fs.existsSync(fileName)) {
      const fileData = JSON.parse(fs.readFileSync(fileName, "utf-8"));
      fileData.endingCounts.forEach(([key, value]) => {
        consolidatedData.endingCounts.set(
          key,
          (consolidatedData.endingCounts.get(key) || 0) + value
        );
      });
      if (fileData.endingDetails) {
        fileData.endingDetails.forEach(([key, value]) => {
          consolidatedData.endingDetails.set(key, value);
        });
      }
      if (fileData.errors) {
        consolidatedData.errors.push(...fileData.errors);
      }
      consolidatedData.maxDepthReached = Math.max(
        consolidatedData.maxDepthReached,
        fileData.maxDepthReached || 0
      );
      consolidatedData.maxDepthAborts += fileData.maxDepthAborts || 0;
      consolidatedData.maxObjectsBetweenChoices = Math.max(
        consolidatedData.maxObjectsBetweenChoices,
        fileData.maxObjectsBetweenChoices || 0
      );
    }
  }

  return consolidatedData;
};

let loggerClosed = false;

const closeLogger = () => {
  return new Promise((resolve) => {
    if (!loggerClosed) {
      logger.on("finish", resolve);
      logger.end();
      loggerClosed = true;
    } else {
      resolve();
    }
  });
};

const func = () => {
  while (story.canContinue) {
    const line = story.Continue();

    let backUpJson = story.state.toJson();
    for (let i = 0; i < story.currentChoices.length; i++) {
      let choice = story.currentChoices[i];
      story.ChooseChoiceIndex(choice.index);
      func();

      story.state.LoadJson(backUpJson);
    }
  }
};

(async () => {
  try {
    const initialStateJson = JSON.stringify(story.state.toJson());
    pathStack.push({
      stateJson: initialStateJson,
      path: [],
      depth: 0,
      objectCount: 0,
    });
    console.log("Starting traversal with initial state:", initialStateJson);
    console.time("dfsTraversal");
    await dfsTraversal();
    console.timeEnd("dfsTraversal");
  } finally {
    await writeFinalReportAndCloseLogger();
  }
})();
