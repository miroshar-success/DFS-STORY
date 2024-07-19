const fs = require("fs");
const { Story } = require("inkjs");
const winston = require("winston");
const readlineSync = require("readline-sync");
const crypto = require("crypto");
const util = require("util");
const path = require("path");
const { stringify } = require("querystring");

// Load the Ink JSON story file
const storyFilePath = "./data/OneNightOneBar.json"; //process.argv[2];
const outputFilePrefix = "progress"; //process.argv[3] || "progress";

// Function to generate a unique file name prefix
const generateUniquePrefix = (storyFilePath) => {
  const storyFileName = path.basename(storyFilePath, ".json");
  const timestamp = new Date()
    .toISOString()
    .replace(/[:]/g, "-")
    .replace(/[T]/g, "_")
    .split(".")[0];
  return `${storyFileName}_${timestamp}`;
};

// Generate unique prefix for this session
const uniquePrefix = generateUniquePrefix(storyFilePath);

// Extract the --continue argument value if provided
const continueArg = process.argv.find((arg) => arg.startsWith("--continue="));
const BATCH_SIZE = continueArg ? parseInt(continueArg.split("=")[1]) : 20000; // smaller batch size
const CONTINUE_INTERVAL = 10000000; // New constant for continue interval

const inkJson = JSON.parse(
  fs.readFileSync(storyFilePath, "utf-8").replace(/^\uFEFF/, "")
);

// Initialize InkJS Story
const story = new Story(inkJson);

// process.exit(0);

let visitedStates = new Set();
const pathStack = [];
let endingCounts = new Map();
let stateCounter = 0;
let choicesCount = 0;
let endingsCount = 0;
const allErrors = []; // This will store all errors encountered
let totalErrors = 0;
let fileCounter = 0;
let batchCounter = 0;
const MEMORY_LIMIT = 26 * 1024 * 1024 * 1024; // 26 GB
let lastMadeChoice = null;
let truePath = [];

// New variables for depth limit and loop detection
const MAX_DEPTH = 200; // Set your desired maximum depth
let maxDepthReached = 0;
let maxDepthAborts = 0;
const LOOP_THRESHOLD = 3; // Set your desired loop threshold
const MAX_OBJECTS_PER_PATH = 1000; // Maximum number of objects allowed per path

let maxObjectsBetweenChoices = 0;
const MAX_OBJECTS_BETWEEN_CHOICES = 1000; // Adjust this value as needed

const knotsExceedingMaxObjects = new Set();
const knotErrorTypes = new Map(); // New Map to track error types per knot

let lastKnownKnot = story.state.currentPathString.split(".")[0]; // Initialize with the starting knot

// Configure Winston logger
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
      level: "ending", // This file transport will include all levels
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
      level: "error", // Only log errors to console
    }),
  ],
});

// Helper function to get a unique hash for the current state
const getStateHash = (stateJson) =>
  crypto.createHash("sha1").update(stateJson).digest("hex");

// Helper function to get the current knot name and last line of text
const getCurrentEndingDetail = () => {
  const lastLine = story.currentText.trim();
  const currentKnot =
    story.state.currentPathString || lastKnownKnot || "Unknown";
  return {
    knot: currentKnot,
    lastLine: lastLine || "",
  };
};

// Error handler
const handleError = (message, type, truePath, lastChoice) => {
  const currentKnot = lastKnownKnot;

  // Create a unique key for this knot and error type
  const errorKey = `${currentKnot}:${type}`;

  // Only add the error if we haven't seen this type for this knot before
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

// Replace the existing story.onError with this:
story.onError = (message, type) => {
  handleError(message, type, truePath, lastMadeChoice);
};

// Function to display progress
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

// Function to log memory usage
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

// Function to write progress to file incrementally
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
  maxObjectsBetweenChoices = 0; // Reset after writing checkpoint
  if (global.gc) {
    global.gc();
  }
};

// Function to ask the user whether to continue or stop
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

// Function to clean up temporary files
const cleanUpTempFiles = () => {
  for (let i = 0; i < fileCounter - 1; i++) {
    // Leave the last checkpoint file
    const fileName = `${uniquePrefix}_checkpoint_${i}.json`;
    if (fs.existsSync(fileName)) {
      fs.unlinkSync(fileName);
      logger.info(`Temporary file ${fileName} deleted.`);
    }
  }
};

// Function to monitor and manage memory usage
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
    maxObjectsBetweenChoices = 0; // Reset after writing checkpoint
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

  // Load the state
  story.state.LoadJson(JSON.parse(stateJson));
  const currentKnot = story.state.currentPathString.split(".")[0];
  lastKnownKnot = currentKnot; // Update the last known knot

  const stateKey = getStateHash(stateJson);
  if (visitedStates.has(stateKey)) {
    return;
  }
  visitedStates.add(stateKey);

  // Detect loops using state repetitions within this specific path
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

  let objectsBetweenChoices = 0; // Local variable, reset for each call

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
    }
    story.state.LoadJson(JSON.parse(stateBefore));
  }
};

const dfsTraversal = async () => {
  let batchCounter = 0;

  while (pathStack.length > 0) {
    const { stateJson, path, depth } = pathStack.pop();
    choicesCount++;
    truePath = path;

    // Track state repetitions for each path individually
    let stateRepetitions = new Map();

    try {
      processChoices(stateJson, path, depth, stateRepetitions);
      // console.log(story.state.currentText);
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

    // Log progress every 1000 choices
    if (choicesCount % 1000 === 0) {
      console.log(`Processed ${choicesCount} choices. Current depth: ${depth}`);
      logMemoryUsage();
    }

    // Ask to continue every 100,000 endings
    if (endingsCount % CONTINUE_INTERVAL === 0 && endingsCount > 0) {
      askToContinue();
    }

    monitorMemoryUsage(fileCounter);
  }

  // Ensure final report is written when traversal completes
  await writeFinalReport();
};

// Function to write the final comprehensive report and close the logger
const writeFinalReportAndCloseLogger = async () => {
  await writeFinalReport();
  await finalize();
};

// Function to generate the final comprehensive report
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

  // Print error details
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

// Function to clean up and close the logger
const finalize = async () => {
  cleanUpTempFiles();
  await closeLogger();
};

// Function to read all progress files and consolidate data
const consolidateProgress = () => {
  let consolidatedData = {
    endingCounts: new Map(),
    endingDetails: new Map(),
    errors: [...allErrors], // Use allErrors to store every error encountered
    maxDepthReached: maxDepthReached,
    maxDepthAborts: maxDepthAborts,
    maxObjectsBetweenChoices: maxObjectsBetweenChoices,
  };

  for (let i = 0; i < fileCounter; i++) {
    const fileName = `${uniquePrefix}_checkpoint_${i}.json`;
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

// Flag to ensure logger is closed only once
let loggerClosed = false;

// Function to close the logger safely
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

// Function to print the call stack
function printCallStack(story1) {
  const callStack = story1.state.callStack;
  console.log("Call Stack:");
  callStack.elements.forEach((element, index) => {
    console.log(`Stack Level ${index + 1}:`);
    console.log(`  Type: ${element.type}`);
    console.log(`  Path: ${element.currentPointer}`);
    console.log(`  Variables:`);
    for (const [key, value] of Object.entries(element.temporaryVariables)) {
      console.log(`    ${key}: ${value}`);
    }
  });
}

const func = () => {
  while (story.canContinue) {
    const line = story.Continue();

    console.log(line);
    backUpJson = story.state.toJson();
    console.log(backUpJson);
    for (let i = 0; i < story.currentChoices.length; i++) {
      let choice = story.currentChoices[i];
      story.ChooseChoiceIndex(choice.index);
      func();

      // logMemoryUsage();
      story.state.LoadJson(backUpJson);
    }
  }
};

func();
// Main execution
(async () => {
  try {
    // Initialize the path stack with the initial state
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
    // Ensure the final report is written and the logger is closed
    await writeFinalReportAndCloseLogger();
  }
})();
