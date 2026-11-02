const express = require('express');
const fs = require('fs/promises');
const path = require('path');
require('dotenv').config();

const { processAPAData } = require('./excelParser');
const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const PROCESSED_DATA_PATH = path.join(DATA_DIR, 'processed', 'rosters_converted.json');
const GAME_DAY_LOG_PATH = path.join(DATA_DIR, 'processed', 'gameday_results.json');
const RACE_TARGETS = { 1: 14, 2: 19, 3: 25, 4: 31, 5: 38, 6: 46, 7: 55, 8: 65, 9: 75 };

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname), { index: false }));

const cache = {
  data: null,
  byMemberId: new Map(),
  byTeam: new Map(),
  expiresAt: 0
};

async function ensureDataFiles() {
  await fs.mkdir(path.join(DATA_DIR, 'processed'), { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, 'raw'), { recursive: true });

  try {
    await fs.access(PROCESSED_DATA_PATH);
  } catch {
    await fs.writeFile(PROCESSED_DATA_PATH, '[]', 'utf8');
  }

  try {
    await fs.access(GAME_DAY_LOG_PATH);
  } catch {
    await fs.writeFile(GAME_DAY_LOG_PATH, '[]', 'utf8');
  }
}

function buildIndexes(stats) {
  const byMemberId = new Map();
  const byTeam = new Map();

  for (const player of stats) {
    if (!player || typeof player !== 'object') continue;

    const memberId = String(player.memberId ?? '');
    if (memberId) {
      byMemberId.set(memberId, player);
    }

    const teamName = String(player.teamName ?? '').trim();
    if (teamName) {
      if (!byTeam.has(teamName)) {
        byTeam.set(teamName, []);
      }
      byTeam.get(teamName).push(player);
    }
  }

  return { byMemberId, byTeam };
}

async function reloadDataCache() {
  await ensureDataFiles();

  try {
    const raw = await fs.readFile(PROCESSED_DATA_PATH, 'utf8');
    const data = JSON.parse(raw);
    const stats = Array.isArray(data) ? data : [];
    const indexes = buildIndexes(stats);

    cache.data = stats;
    cache.byMemberId = indexes.byMemberId;
    cache.byTeam = indexes.byTeam;
    cache.expiresAt = Date.now() + 5000;
    return stats;
  } catch (error) {
    cache.data = [];
    cache.byMemberId = new Map();
    cache.byTeam = new Map();
    cache.expiresAt = 0;
    return [];
  }
}

async function getProcessedData() {
  if (cache.data && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  return reloadDataCache();
}

app.get('/health', async (_req, res) => {
  try {
    const stats = await getProcessedData();
    res.json({ ok: true, recordCount: stats.length, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Health check failed.' });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/gameday/record-match', async (req, res) => {
  try {
    const { homePlayerId, awayPlayerId, homePointsEarned, awayPointsEarned } = req.body;

    if (!homePlayerId || !awayPlayerId || homePointsEarned === undefined || awayPointsEarned === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Please provide homePlayerId, awayPlayerId, homePointsEarned, and awayPointsEarned.'
      });
    }

    const stats = await getProcessedData();
    if (!stats.length) {
      return res.status(404).json({ success: false, error: 'No scouting data loaded.' });
    }

    const homePlayer = cache.byMemberId.get(String(homePlayerId)) || stats.find(p => String(p.memberId) === String(homePlayerId));
    const awayPlayer = cache.byMemberId.get(String(awayPlayerId)) || stats.find(p => String(p.memberId) === String(awayPlayerId));

    if (!homePlayer || !awayPlayer) {
      return res.status(404).json({ success: false, error: 'One or both player IDs could not be found.' });
    }

    const homeTarget = RACE_TARGETS[homePlayer.skillLevel] || 25;
    const awayTarget = RACE_TARGETS[awayPlayer.skillLevel] || 25;
    const homeWon = homePointsEarned >= homeTarget;
    const awayWon = awayPointsEarned >= awayTarget;

    let matchWinner = 'Ongoing / Incomplete';
    if (homeWon && !awayWon) {
      matchWinner = homePlayer.playerName;
    } else if (awayWon && !homeWon) {
      matchWinner = awayPlayer.playerName;
    } else if (homePointsEarned > awayPointsEarned) {
      matchWinner = homePlayer.playerName;
    } else if (awayPointsEarned > homePointsEarned) {
      matchWinner = awayPlayer.playerName;
    }

    const resultRecord = {
      timestamp: new Date().toISOString(),
      homePlayer: {
        name: homePlayer.playerName,
        team: homePlayer.teamName,
        skillLevel: homePlayer.skillLevel,
        target: homeTarget,
        pointsEarned: homePointsEarned
      },
      awayPlayer: {
        name: awayPlayer.playerName,
        team: awayPlayer.teamName,
        skillLevel: awayPlayer.skillLevel,
        target: awayTarget,
        pointsEarned: awayPointsEarned
      },
      winner: matchWinner
    };

    let existingLogs = [];
    try {
      const raw = await fs.readFile(GAME_DAY_LOG_PATH, 'utf8');
      existingLogs = JSON.parse(raw);
    } catch {
      existingLogs = [];
    }

    existingLogs.push(resultRecord);
    await fs.writeFile(GAME_DAY_LOG_PATH, JSON.stringify(existingLogs, null, 2), 'utf8');

    return res.json({
      success: true,
      message: 'GameDay match score recorded successfully!',
      matchSummary: resultRecord
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Error recording GameDay match score.' });
  }
});

app.get('/api/scouting-reports', async (_req, res) => {
  try {
    const stats = await getProcessedData();
    if (!stats.length) {
      return res.status(404).json({
        success: false,
        error: 'Scouting reports not found for this week yet. Please run administrative ingestion.'
      });
    }

    return res.json({ success: true, count: stats.length, data: stats });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to retrieve scouting reports.' });
  }
});

app.get('/api/teams/:teamName', async (req, res) => {
  try {
    const stats = await getProcessedData();
    const teamName = decodeURIComponent(req.params.teamName).toLowerCase();
    const teamRoster = stats.filter((player) => player.teamName && player.teamName.toLowerCase() === teamName);

    if (!teamRoster.length) {
      return res.status(404).json({ success: false, error: `Team "${req.params.teamName}" not found.` });
    }

    return res.json({
      success: true,
      team: req.params.teamName,
      rosterCount: teamRoster.length,
      roster: teamRoster
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Server error retrieving team roster.' });
  }
});

app.get('/api/matchup', async (req, res) => {
  try {
    const { home, away } = req.query;
    if (!home || !away) {
      return res.status(400).json({
        success: false,
        error: 'Please provide both "home" and "away" team query parameters.'
      });
    }

    const stats = await getProcessedData();
    const homeRoster = stats.filter((p) => p.teamName && p.teamName.toLowerCase() === String(home).toLowerCase());
    const awayRoster = stats.filter((p) => p.teamName && p.teamName.toLowerCase() === String(away).toLowerCase());

    return res.json({
      success: true,
      matchup: {
        homeTeam: { name: home, roster: homeRoster },
        awayTeam: { name: away, roster: awayRoster }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Error generating matchup comparison.' });
  }
});

app.get('/api/compare-player', async (req, res) => {
  try {
    const { opponentId, userTeam } = req.query;
    if (!opponentId || !userTeam) {
      return res.status(400).json({
        success: false,
        error: 'Please provide both "opponentId" and "userTeam" query parameters.'
      });
    }

    const stats = await getProcessedData();
    const opponent = stats.find((p) => String(p.memberId) === String(opponentId));
    if (!opponent) {
      return res.status(404).json({ success: false, error: `Opponent with ID ${opponentId} not found.` });
    }

    const userRoster = stats.filter((p) => p.teamName && p.teamName.toLowerCase() === String(userTeam).toLowerCase());

    const matchUpAnalysis = userRoster.map((player) => {
      const skillDiff = player.skillLevel - opponent.skillLevel;
      const ppmDiff = Number((player.ppm - opponent.ppm).toFixed(2));

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
        ppmDifferential: ppmDiff,
        tacticalAdvantage: advantage
      };
    });

    matchUpAnalysis.sort((a, b) => b.ppmDifferential - a.ppmDifferential);

    return res.json({
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
    return res.status(500).json({ success: false, error: 'Error processing player comparison.' });
  }
});

app.post('/api/calculator/23-rule', async (req, res) => {
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

    const stats = await getProcessedData();
    const lineupPlayers = stats.filter((p) => selectedPlayerIds.includes(String(p.memberId)));

    if (!lineupPlayers.length) {
      return res.status(404).json({ success: false, error: 'None of the provided player IDs were found.' });
    }

    const totalSkill = lineupPlayers.reduce((sum, p) => sum + Number(p.skillLevel || 0), 0);
    const isLegal = totalSkill <= 23;
    const totalPPM = lineupPlayers.reduce((sum, p) => sum + Number(p.ppm || 0), 0);
    const avgPPM = Number((totalPPM / lineupPlayers.length).toFixed(2));

    let recommendation = 'Lineup is valid and ready for GameDay!';
    if (!isLegal) {
      const overBy = totalSkill - 23;
      recommendation = `Lineup ILLEGAL! You are ${overBy} point(s) over the 23-skill cap. Swap out a higher skill level player for a lower skill level player.`;
    } else if (selectedPlayerIds.length === 5 && totalSkill < 19) {
      recommendation = 'Lineup is legal, but you have 5 or more unused skill points available. Consider putting in a stronger player!';
    }

    return res.json({
      success: true,
      teamName,
      lineupCount: lineupPlayers.length,
      totalSkillLevel: totalSkill,
      isLegalLineup: isLegal,
      maxAllowedSkill: 23,
      remainingSkillCap: 23 - totalSkill,
      combinedPPM: Number(totalPPM.toFixed(2)),
      averagePPM: avgPPM,
      recommendation,
      selectedLineup: lineupPlayers.map((p) => ({
        playerName: p.playerName,
        memberId: p.memberId,
        skillLevel: p.skillLevel,
        ppm: p.ppm,
        winPercentage: p.winPercentage
      }))
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Error calculating 23-rule lineup.' });
  }
});

app.post('/api/admin/process-week', async (req, res) => {
  try {
    const { fileName } = req.body;
    if (!fileName) {
      return res.status(400).json({ success: false, error: 'Missing "fileName" parameter in request body.' });
    }

    const processedData = await processAPAData(fileName);
    await fs.writeFile(PROCESSED_DATA_PATH, JSON.stringify(processedData, null, 2), 'utf8');
    await reloadDataCache();

    return res.json({
      success: true,
      message: `Successfully parsed and updated stats for file: ${fileName}`,
      totalRecordsProcessed: processedData.length
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to process week data.' });
  }
});

async function startServer() {
  await ensureDataFiles();
  await reloadDataCache();

  app.listen(PORT, () => {
    console.log(`🚀 Smart Captain Club API running on http://localhost:${PORT}`);
  });
}

startServer();

module.exports = app;

"use strict";
