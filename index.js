const express = require('express');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');

const app = express();
app.use(bodyParser.json());

const lokka = spawn('cmd', ['/c', 'npx', '-y', '@merill/lokka'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    TENANT_ID: process.env.TENANT_ID,
    CLIENT_ID: process.env.CLIENT_ID,
    CLIENT_SECRET: process.env.CLIENT_SECRET
  }
});

app.post('/mcp', (req, res) => {
  lokka.stdin.write(JSON.stringify(req.body) + '\n');
  lokka.stdout.once('data', (data) => {
    res.send(data.toString());
  });
});

app.get('/', (req, res) => {
  res.send('Lokka MCP Server is running. Use POST /mcp to send requests.');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

//some changes