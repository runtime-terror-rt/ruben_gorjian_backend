const ExcelJS = require('exceljs');

async function run() {
  const wb = new ExcelJS.Workbook();
  const fs = require('fs');
  // I need an actual xlsx file with emojis to test.
  console.log("ExcelJS is installed and working!");
}
run();
