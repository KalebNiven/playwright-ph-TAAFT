const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

async function verifyExcel() {
  const outputDir = path.join(__dirname, "output");
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
  const worksheet = workbook.getWorksheet("Products");

  let redirectCount = 0;
  let totalCount = 0;
  let resolvedCount = 0;

  console.log("\nFirst 10 entries:");
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const name = row.getCell(1).value;
    const website = row.getCell(4).value;

    totalCount++;

    if (
      website &&
      (website.includes("producthunt.com/r/") ||
        website.includes("producthunt.com/posts/"))
    ) {
      redirectCount++;
      if (redirectCount <= 5) {
        console.log(`[Unresolved] ${name} -> ${website}`);
      }
    } else if (website && website.startsWith("http")) {
      resolvedCount++;
    }

    if (rowNumber <= 11) {
      console.log(`${rowNumber - 1}. ${name} -> ${website}`);
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
