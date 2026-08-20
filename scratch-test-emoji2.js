const xlsx = require("xlsx");
const buf = Buffer.from("Date night just got a whole lot better. 🍷 Rigatoni", "utf-8");
const wb = xlsx.utils.book_new();
const ws = xlsx.utils.aoa_to_sheet([["Caption", "Suggested Post Date"], ["Date night just got a whole lot better. 🍷 Rigatoni", new Date()]]);
xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
const xlsxBuf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });

const readWb = xlsx.read(xlsxBuf, { type: "buffer", cellDates: true });
const readWs = readWb.Sheets[readWb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(readWs, { defval: "" });
console.log(data);

const dataRawFalse = xlsx.utils.sheet_to_json(readWs, { defval: "", raw: false });
console.log("Raw False:", dataRawFalse);
