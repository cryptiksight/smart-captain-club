const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

function processAPAData(fileName) {
    const filePath = path.join(__dirname, '../data/raw/league_rosters.xlsx');
    
    // Read the Excel file downloaded from APA Member Services
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // Map raw spreadsheet rows into a structured format
    const formattedData = rawData.map(row => ({
        playerName: row['Player Name'] || '',
        memberId: row['#'] || '',
        skillLevel: Number(row['Skill Level']) || 0,
        matchesWon: Number(row['Matches Won']) || 0,
        matchesPlayed: Number(row['Matches Played']) || 0,
        winPercentage: row['Win %'] || '0%',
        ppm: Number(row['PPM']) || 0.00,
        pa: row['PA'] || '0%'
    }));

    // Save the processed output into the processed folder for your app database
    const outputPath = path.join(__dirname, '../data/processed/current_week_stats.json');
    fs.writeFileSync(outputPath, JSON.stringify(formattedData, null, 2));
    
    console.log(`Successfully processed ${formattedData.length} player records!`);
    return formattedData;
}

module.exports = { processAPAData };
