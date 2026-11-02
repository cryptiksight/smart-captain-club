const fs = require('fs');

function convertTextToCSV(inputFilePath, outputCSVPath) {
    const rawText = fs.readFileSync(inputFilePath, 'utf-8');
    const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);

    let csvRows = ['TeamName,HomeLocation,PlayerName,MemberID,SkillLevel,MatchesWon,MatchesPlayed,WinPercent,PPM,PA'];
    let parsedData = [];
    
    let currentTeam = 'Unknown Team';
    let currentHome = 'Unknown Location';
    
    let i = 0;
    while (i < lines.length) {
        let line = lines[i];

        // 1. Detect Team Header (Line followed by "Home:")
        if (i + 1 < lines.length && lines[i + 1].startsWith('Home:')) {
            currentTeam = line;
            currentHome = lines[i + 1].replace('Home:', '').trim();
            i += 2;
            continue;
        }

        // 2. Detect Player Block (Member ID starts with '#')
        if (line.startsWith('#')) {
            let memberId = line.replace('#', '').trim();
            let playerName = lines[i - 1] || 'Unknown Player';
            
            // The next line contains: Skill Level, Record, Win %, PPM, PA separated by tabs/spaces
            let statsLine = lines[i + 1] || '';
            let statsParts = statsLine.split(/\s+/);

            let skillLevel = statsParts[0] || '0';
            let recordLine = statsParts[1] || '0/0';
            let winPct = statsParts[2] || '0%';
            let ppm = statsParts[3] || '0';
            let pa = statsParts[4] || '0%';

            let parsedSkill = skillLevel === '-' ? 0 : Number(skillLevel);
            let [won, played] = recordLine.includes('/') ? recordLine.split('/') : ['0', '0'];

            // Only add if it's a valid player entry
            if (memberId && playerName) {
                parsedData.push({
                    teamName: currentTeam,
                    homeLocation: currentHome,
                    playerName: playerName,
                    memberId: memberId,
                    skillLevel: isNaN(parsedSkill) ? 0 : parsedSkill,
                    matchesWon: Number(won) || 0,
                    matchesPlayed: Number(played) || 0,
                    winPercentage: winPct,
                    ppm: Number(ppm) || 0,
                    pa: pa
                });

                csvRows.push(`"${currentTeam}","${currentHome}","${playerName}",${memberId},${parsedSkill},${won || 0},${played || 0},"${winPct}",${ppm},"${pa}"`);
            }

            i += 2; // Move past ID and stats line
        } else {
            i++;
        }
    }

    fs.writeFileSync(outputCSVPath, csvRows.join('\n'));
    
    const jsonOutputPath = outputCSVPath.replace('.csv', '.json');
    fs.writeFileSync(jsonOutputPath, JSON.stringify(parsedData, null, 2));

    console.log(`Successfully parsed ${parsedData.length} player records cleanly!`);
    return parsedData;
}

module.exports = { convertTextToCSV };