const fs = require("fs");
const process = require("process");
const path = require("path");

// Check if the filename is provided
if (process.argv.length < 3) {
  console.log("Usage: node process_data.js <filename>");
  process.exit(1);
}

const filename = process.argv[2];

// Read the data from the JSON file
const rawData = fs.readFileSync(filename);
const data = JSON.parse(rawData);

// Extract the required information
const choicesCount = data.choicesCount;
const endingsCount = data.endingsCount;
const maxDepthReached = data.maxDepthReached;
const maxDepthAborts = data.maxDepthAborts;
const maxObjectsBetweenChoices = data.maxObjectsBetweenChoices;

// Prepare error reporting
const uniqueErrors = new Set();
const errors = data.allErrors || [];
const knotNamesWithErrors = new Set();
let uniqueErrorCount = 0;

// Helper function to safely parse a JSON string
const safeParse = (jsonString) => {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    return null;
  }
};

// Helper function to create a unique error string
const createErrorString = (error) => {
  const message = error.message;
  const knot = error.knot;
  const path = error.path.join(" > ");
  const steps = error.path.length;

  // Safely parse stateAfter even if it has been double-converted
  let stateAfter = safeParse(error.stateAfter);
  if (stateAfter && typeof stateAfter === "string") {
    stateAfter = safeParse(stateAfter);
  }

  const variablesState = stateAfter
    ? Object.entries(stateAfter.variablesState)
        .map(([key, value]) => `${key}: ${value}`)
        .join(", ")
    : "N/A";

  return `Error Message: ${message}\nLast Knot Before Error: ${knot}\nPath To Error (${steps} Steps): ${path}\nVariables In Use At Error: ${variablesState}\n`;
};

// Scan for unique errors and knots
errors.forEach((error) => {
  const errorString = createErrorString(error);
  if (!uniqueErrors.has(errorString)) {
    uniqueErrors.add(errorString);
    uniqueErrorCount++;
    knotNamesWithErrors.add(error.knot);
  }
});

// Create the report content
let reportContent = `Total Choices Clicked: ${choicesCount}\n`;
reportContent += `Total Endings Reached: ${endingsCount}\n`;
reportContent += `Maximum Depth Of A Path: ${maxDepthReached}\n`;
reportContent += `Paths Too Deep To Crawl: ${maxDepthAborts}\n`;
reportContent += `Maximum Steps Between Choices: ${maxObjectsBetweenChoices}\n`;
reportContent += `\nTotal Number of Unique Errors: ${uniqueErrorCount}\n`;

reportContent += `Total Number of Knots With Errors: ${knotNamesWithErrors.size}\n`;
knotNamesWithErrors.forEach((knot) => {
  reportContent += `${knot}\n`;
});

reportContent += `\n`;

let errorNumber = 1;
for (const error of uniqueErrors) {
  reportContent += `Error Number: ${errorNumber}\n`;
  reportContent += `${error}\n`;
  errorNumber++;
}

reportContent += "End of Report\n";

// Write the report to a file
const reportFilename =
  path.basename(filename, path.extname(filename)) + "_Report.txt";
fs.writeFileSync(reportFilename, reportContent);

console.log(`Report written to ${reportFilename}`);
