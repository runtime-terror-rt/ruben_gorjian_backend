import net from "net";
import express from "express";

const router = express.Router();

router.get("/", async (req, res) => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);

  if (!host || !process.env.SMTP_PORT) {
    return res.json({ success: false, error: "SMTP configuration missing" });
  }

  const socket = new net.Socket();
  const timeoutMs = 5000;

  socket.setTimeout(timeoutMs);

  socket.connect(port, host, () => {
    res.json({ success: true, message: `Connected to ${host}:${port}` });
    socket.destroy();
  });

  socket.on("error", (err) => {
    res.json({ success: false, error: err.message });
  });

  socket.on("timeout", () => {
    res.json({ success: false, error: "Connection timed out" });
    socket.destroy();
  });
});

export { router as smtpTestRouter };
