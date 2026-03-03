const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

async function verifyExcel() {
  const outputDir = '/Users/nastyabalashova/Desktop/APPSUMO/SOURCING';
  if (!fs.existsSync(outputDir)) {
    console.error(`Output directory not found: ${outputDir}`);
    return;
  }

  // Find the most recent file
  const files = fs
    .readdirSync(outputDir)
    .filter((f) => f.endsWith(".xlsx"))
    .map((f) => ({
      name: f,
      time: fs.statSync(path.join(outputDir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time);

  const latestFile = files.length > 0 ? files[0].name : null;

  if (!latestFile) {
    console.error("No Excel file found.");
    return;
  }

  const filePath = path.join(outputDir, latestFile);
  console.log(`Verifying file: ${filePath}`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  // List all worksheets to debug
  workbook.eachSheet(function (worksheet, sheetId) {
    console.log("Sheet Name: " + worksheet.name);
  });

  const worksheet = workbook.getWorksheet("Products") || workbook.worksheets[0]; // Fallback to first sheet

  let redirectCount = 0;
  let totalCount = 0;
  let resolvedCount = 0;

  console.log("\nFirst 10 entries:");
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const name = row.getCell(1).value; // Column A: Company
    const websiteCell = row.getCell(5); // Column E is 5
    let website = websiteCell.value;

    totalCount++;

    // Some websites might be objects if they are hyperlinks in Excel
    let websiteUrl = website;
    if (website && typeof website === "object" && website.text) {
      websiteUrl = website.text;
    } else if (website && typeof website === "object" && website.hyperlink) {
      websiteUrl = website.hyperlink;
    }

    // Ensure string
    websiteUrl = String(websiteUrl || "");

    if (
      websiteUrl &&
      (websiteUrl.includes("producthunt.com/r/") ||
        websiteUrl.includes("producthunt.com/posts/") ||
        websiteUrl.includes("theresanaiforthat.com"))
    ) {
      redirectCount++;
      if (redirectCount <= 5) {
        console.log(`[Unresolved] ${name} -> ${websiteUrl}`);
      }
    } else if (websiteUrl && websiteUrl.startsWith("http")) {
      resolvedCount++;
    }

    if (rowNumber <= 11) {
      console.log(`${rowNumber - 1}. ${name} -> ${websiteUrl}`);
    }
  });

  console.log("\nSummary:");
  console.log(`Total Rows: ${totalCount}`);
  console.log(`Resolved Websites: ${resolvedCount}`);
  console.log(`Unresolved Redirects: ${redirectCount}`);

  if (redirectCount === 0 && resolvedCount > 0) {
    console.log("\nSUCCESS: All redirects appear to be resolved.");
  } else {
    console.log("\nWARNING: Some redirects remain or no websites found.");
  }
}

verifyExcel();
