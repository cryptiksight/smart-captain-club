const { convertTextToCSV } = require('./services/csvParser');

try {
    console.log('Starting text-to-CSV conversion...');
    convertTextToCSV('./data/raw/full_division_rosters_8-Ball.txt', './data/processed/rosters_converted.csv');
    console.log('Test completed successfully!');
} catch (error) {
    console.error('Error during conversion:', error.message);
}
