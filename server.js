require("dotenv").config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const userRoutes = require('./routes/userRoutes');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
    origin: "http://localhost:3000",
    credentials: true,
}))

app.use(express.json());

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "build")));

app.use('/api', userRoutes);

app.get("/{*any}", (req, res) => {
    res.sendFile(path.join(__dirname, "build", "index.html"));
});

app.listen(port,() => {
  console.log(`Server running at http://localhost:${port}`);
});


