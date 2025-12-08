const express = require("express");
const cors = require("cors");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

app.use("/", (req, res) => {
  res.send("Invalid route");
});

app.listen(port, () => {
  console.log(`Server is running on port: `, port);
});
