
const ExcelJS = require('exceljs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output');
const filename = 'ProductHunt_Leaderboard_2026-02-25.xlsx'; 
const filepath = path.join(OUTPUT_DIR, filename);

(async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filepath);
    const worksheet = workbook.getWorksheet('Products');
    
    const targetNames = ['Killer Claw', 'Arzul', 'Notion', 'Custom Agents', 'AskFellow'];
    const found = [];
    
    // Correct columns:
    // 1: Name
    // 2: Tagline
    // 3: Upvotes
    // 4: Website

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header

        const name = row.getCell(1).value; 
        const upvotes = row.getCell(3).value; 
        
        if (name) {
             const nameLower = name.toString().toLowerCase();
             targetNames.forEach(target => {
                 if (nameLower.includes(target.toLowerCase())) {
                     found.push({ name, upvotes, rowNumber });
                 }
             });
        }
    });

    console.log('Found specific products:', found);
    
    const allProducts = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
            allProducts.push({
                name: row.getCell(1).value,
                upvotes: parseInt(row.getCell(3).value || 0)
            });
        }
    });
    
    allProducts.sort((a, b) => b.upvotes - a.upvotes);
    console.log('Top 10 in file by upvotes:', allProducts.slice(0, 10));

})();
