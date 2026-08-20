const xlsx = require("xlsx");
const buf = Buffer.from("Date night just got a whole lot better. 🍷 Rigatoni", "utf-8");
const wb = xlsx.utils.book_new();
const ws = xlsx.utils.aoa_to_sheet([["Caption"], ["Date night just got a whole lot better. 🍷 Rigatoni"]]);
xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
const xlsxBuf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

const readWb = xlsx.read(xlsxBuf, { type: "buffer" });
const readWs = readWb.Sheets[readWb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(readWs);
console.log(data);
