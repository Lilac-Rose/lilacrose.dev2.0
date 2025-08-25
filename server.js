require('dotenv').config();
const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send(`Hello from lilacrose.dev! Environment: ${process.env.NODE_ENV}`);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`App running on http://127.0.0.1:${PORT}`);
});
