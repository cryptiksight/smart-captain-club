require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { processAPAData } = require('./services/excelParser');
const { convertTextToCSV } = require('./services/csvParser');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON payloads
app.use(express.json());
// Serve static frontend files (index.html, CSS, JS) from the root project folder
app.use(express.static(path.join(__dirname)));

// Root route: Serve the main Smart Captain Club dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
// Helper function to safely read processed JSON data
const getProcessedData = () => {
    const dataPath = path.join(__dirname, './data/processed/rosters_converted.json');
    if (!fs.existsSync(dataPath)) {
        return null;
    }
    const rawData = fs.readFileSync(dataPath, 'utf-8');
    return JSON.parse(rawData);
};
/**
 * POST /api/gameday/record-match
 * Records a completed individual match score on GameDay, tracking points earned vs. race target.
 * Body Payload: 
 * {
 *   "homePlayerId": "35292442",
 *   "awayPlayerId": "35209188",
 *   "homePointsEarned": 25,
 *   "awayPointsEarned": 46
 * }
 */
app.post('/api/gameday/record-match', (req, res) => {
    try {
        const { homePlayerId, awayPlayerId, homePointsEarned, awayPointsEarned } = req.body;

        if (!homePlayerId || !awayPlayerId || homePointsEarned === undefined || awayPointsEarned === undefined) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please provide homePlayerId, awayPlayerId, homePointsEarned, and awayPointsEarned.' 
            });
        }

        const stats = getProcessedData();
        if (!stats) {
            return res.status(404).json({ success: false, error: 'No scouting data loaded.' });
        }

        // Find both players in the database
        const homePlayer = stats.find(p => p.memberId === homePlayerId);
        const awayPlayer = stats.find(p => p.memberId === awayPlayerId);

        if (!homePlayer || !awayPlayer) {
            return res.status(404).json({ success: false, error: 'One or both player IDs could not be found.' });
        }

        // APA 9-Ball Race Targets based on Skill Level
        const raceTargets = { 1: 14, 2: 19, 3: 25, 4: 31, 5: 38, 6: 46, 7: 55, 8: 65, 9: 75 };
        const homeTarget = raceTargets[homePlayer.skillLevel] || 25;
        const awayTarget = raceTargets[awayPlayer.skillLevel] || 25;

        // Determine match winner based on who reached their target first or earned the most points
        const homeWon = homePointsEarned >= homeTarget;
        const awayWon = awayPointsEarned >= awayTarget;

        let matchWinner = 'Ongoing / Incomplete';
        if (homeWon && !awayWon) {
            matchWinner = homePlayer.playerName;
        } else if (awayWon && !homeWon) {
            matchWinner = awayPlayer.playerName;
        } else if (homePointsEarned > awayPointsEarned) {
            matchWinner = homePlayer.playerName;
        } else if  (awayPointsEarned > homePointsEarned) {
            matchWinner = awayPlayer.playerName;
        }

        // Save result to a local GameDay log file
        const resultRecord = {
            timestamp: new Date().toISOString(),
            homePlayer: { name: homePlayer.playerName, team: homePlayer.teamName, skillLevel: homePlayer.skillLevel, target: homeTarget, pointsEarned: homePointsEarned },
            awayPlayer: { name: awayPlayer.playerName, team: awayPlayer.teamName, skillLevel: awayPlayer.skillLevel, target: awayTarget, pointsEarned: awayPointsEarned },
            winner: matchWinner
        };

        const logPath = path.join(__dirname, 'data/processed/gameday_results.json');
        let existingLogs = [];
        if (fs.existsSync(logPath)) {
            existingLogs = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
        }
        existingLogs.push(resultRecord);
        fs.writeFileSync(logPath, JSON.stringify(existingLogs, null, 2));

        res.json({
            success: true,
            message: 'GameDay match score recorded successfully!',
            matchSummary: resultRecord
        });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Error recording GameDay match score.' });
    }
});

// ==========================================
// 1. PUBLIC APP ENDPOINTS (For Captains)
// ==========================================

/**
 * GET /api/scouting-reports
 * Retrieves all processed player stats and scouting data for the current week.
 */
app.get('/api/scouting-reports', (req, res) => {
    try {
        const stats = getProcessedData();
        if (!stats) {
            return res.status(404).json({ 
                success: false, 
                error: 'Scouting reports not found for this week yet. Please run administrative ingestion.' 
            });
        }
        res.json({ success: true, count: stats.length, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to retrieve scouting reports.' });
    }
});

/**
 * GET /api/teams/:teamName
 * Retrieves the full roster and player metrics for a specific team.
 * Example: GET /api/teams/Skull%20The%209
 */
app.get('/api/teams/:teamName', (req, res) => {
    try {
        const stats = getProcessedData();
        if (!stats) {
            return res.status(404).json({ success: false, error: 'No data available.' });
        }

        const teamName = decodeURIComponent(req.params.teamName).toLowerCase();
        const teamRoster = stats.filter(player => 
            player.teamName && player.teamName.toLowerCase() === teamName
        );

        if (teamRoster.length === 0) {
            return res.status(404).json({ success: false, error: `Team "${req.params.teamName}" not found.` });
        }

        res.json({ 
            success: true, 
            team: req.params.teamName, 
            rosterCount: teamRoster.length, 
            roster: teamRoster 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server error retrieving team roster.' });
    }
});

/**
 * GET /api/matchup
 * Compares two teams side-by-side for tactical match prep.
 * Query Parameters: ?home=Skull%20The%209&away=Cut%20Throat%20Benders
 */
app.get('/api/matchup', (req, res) => {
    try {
        const { home, away } = req.query;
        if (!home || !away) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please provide both "home" and "away" team query parameters.' 
            });
        }

        const stats = getProcessedData();
        if (!stats) {
            return res.status(404).json({ success: false, error: 'No scouting data loaded.' });
        }

        const homeRoster = stats.filter(p => p.teamName && p.teamName.toLowerCase() === home.toLowerCase());
        const awayRoster = stats.filter(p => p.teamName && p.teamName.toLowerCase() === away.toLowerCase());

        res.json({
            success: true,
            matchup: {
                homeTeam: { name: home, roster: homeRoster },
                awayTeam: { name: away, roster: awayRoster }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Error generating matchup comparison.' });
    }
});
/**
 * GET /api/compare-player
 * Compares an opposing player against an entire team's roster to find the best matchups.
 * Query Parameters: ?opponentId=35209188&userTeam=Skull%20The%209%20(01)
 */
app.get('/api/compare-player', (req, res) => {
    try {
        const { opponentId, userTeam } = req.query;
        if (!opponentId || !userTeam) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please provide both "opponentId" and "userTeam" query parameters.' 
            });
        }

        const stats = getProcessedData();
        if (!stats) {
            return res.status(404).json({ success: false, error: 'No scouting data loaded.' });
        }

        // 1. Find the target opposing player
        const opponent = stats.find(p => p.memberId === opponentId);
        if (!opponent) {
            return res.status(404).json({ success: false, error: `Opponent with ID ${opponentId} not found.` });
        }

        // 2. Find the user's team roster
        const userRoster = stats.filter(p => p.teamName && p.teamName.toLowerCase() === userTeam.toLowerCase());

        // 3. Rank team members against the opponent based on skill differential and PPM
        const matchUpAnalysis = userRoster.map(player => {
            const skillDiff = player.skillLevel - opponent.skillLevel;
            const ppmDiff = (player.ppm - opponent.ppm).toFixed(2);
            
            let advantage = 'Neutral';
            if (player.ppm > opponent.ppm && player.skillLevel <= opponent.skillLevel) {
                advantage = 'High Advantage (Higher PPM at lower/equal Skill)';
            } else if (player.ppm > opponent.ppm) {
                advantage = 'Slight Advantage (Higher PPM)';
            } else if (player.ppm < opponent.ppm) {
                advantage = 'Underdog';
            }

            return {
                playerName: player.playerName,
                skillLevel: player.skillLevel,
                ppm: player.ppm,
                winPercentage: player.winPercentage,
                skillDifferential: skillDiff,
                ppmDifferential: Number(ppmDiff),
                tacticalAdvantage: advantage
            };
        });

        // Sort choices by highest PPM advantage
        matchUpAnalysis.sort((a, b) => b.ppmDifferential - a.ppmDifferential);

        res.json({
            success: true,
            targetOpponent: {
                name: opponent.playerName,
                team: opponent.teamName,
                skillLevel: opponent.skillLevel,
                ppm: opponent.ppm,
                winPercentage: opponent.winPercentage
            },
            recommendedMatchups: matchUpAnalysis
        });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Error processing player comparison.' });
    }
});
/**
 * POST /api/calculator/23-rule
 * Validates a 5-player lineup against the APA 23-Rule limit.
 * Body Payload: 
 * {
 *   "teamName": "Skull The 9 (01)",
 *   "selectedPlayerIds": ["35292442", "35291754", "35272114", "35290917", "35274922"]
 * }
 */
app.post('/api/calculator/23-rule', (req, res) => {
    try {
        const { teamName, selectedPlayerIds } = req.body;

        if (!teamName || !selectedPlayerIds || !Array.isArray(selectedPlayerIds)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please provide a "teamName" and an array of "selectedPlayerIds".' 
            });
        }

        if (selectedPlayerIds.length > 5) {
            return res.status(400).json({ 
                success: false, 
                error: 'An APA lineup cannot exceed 5 players.' 
            });
        }

        const stats = getProcessedData();
        if (!stats) {
            return res.status(404).json({ success: false, error: 'No scouting data loaded.' });
        }

        // Fetch selected players' stats
        const lineupPlayers = stats.filter(p => selectedPlayerIds.includes(p.memberId));

        if (lineupPlayers.length === 0) {
            return res.status(404).json({ success: false, error: 'None of the provided player IDs were found.' });
        }

        // Calculate metrics
        const totalSkill = lineupPlayers.reduce((sum, p) => sum + p.skillLevel, 0);
        const isLegal = totalSkill <= 23;
        const totalPPM = lineupPlayers.reduce((sum, p) => sum + p.ppm, 0);
        const avgPPM = (totalPPM / lineupPlayers.length).toFixed(2);

        // Tactical feedback
        let recommendation = 'Lineup is valid and ready for GameDay!';
        if (!isLegal) {
            const overBy = totalSkill - 23;
            recommendation = `Lineup ILLEGAL! You are ${overBy} point(s) over the 23-skill cap. Swap out a higher skill level player for a lower skill level player.`;
        } else if (selectedPlayerIds.length === 5 && totalSkill < 19) {
            recommendation = 'Lineup is legal, but you have 5 or more unused skill points available. Consider putting in a stronger player!';
        }

        res.json({
            success: true,
            teamName: teamName,
            lineupCount: lineupPlayers.length,
            totalSkillLevel: totalSkill,
            isLegalLineup: isLegal,
            maxAllowedSkill: 23,
            remainingSkillCap: 23 - totalSkill,
            combinedPPM: Number(totalPPM.toFixed(2)),
            averagePPM: Number(avgPPM),
            recommendation: recommendation,
            selectedLineup: lineupPlayers.map(p => ({
                playerName: p.playerName,
                memberId: p.memberId,
                skillLevel: p.skillLevel,
                ppm: p.ppm,
                winPercentage: p.winPercentage
            }))
        });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Error calculating 23-rule lineup.' });
    }
});

// ==========================================
// 2. ADMIN ENDPOINTS (For Data Processing)
// ==========================================

/**
 * POST /api/admin/process-week
 * Triggers processing of a raw APA Excel file dropped into /data/raw
 * Body Payload: { "fileName": "league_rosters.xlsx" }
 */
app.post('/api/admin/process-week', (req, res) => {
    try {
        const { fileName } = req.body;
        if (!fileName) {
            return res.status(400).json({ success: false, error: 'Missing "fileName" parameter in request body.' });
        }

        const processedData = processAPAData(fileName);
        res.json({ 
            success: true, 
            message: `Successfully parsed and updated stats for file: ${fileName}`, 
            totalRecordsProcessed: processedData.length 
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Smart Captain Club API running on http://localhost:${PORT}`);
});
