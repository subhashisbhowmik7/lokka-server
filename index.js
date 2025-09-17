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
//#formatter and try
app.post('/mcp', (req, res) => {
  lokka.stdin.write(JSON.stringify(req.body) + '\n');

  let buffer = '';

  const onData = (chunk) => {
    buffer += chunk.toString();
    console.log('[Lokka Raw Output]', buffer);

    if (buffer.includes('\n')) {
      lokka.stdout.off('data', onData);

      try {
        // Parse outer JSON
        const parsed = JSON.parse(buffer.trim());

        // Lokka's "content" is often inside result.content[0].text
        const rawText = parsed?.result?.content?.[0]?.text ?? '';

        // Extract the JSON part from the text using regex
        const match = rawText.match(/\{[\s\S]*\}/);
        if (!match) {
          return res.json({ message: "No JSON found in response", raw: rawText });
        }

        // Parse the inner JSON
        const extracted = JSON.parse(match[0]);

        // Wrap nicely
        return res.json({
          message: "Graph API result",
          data: extracted
        });

      } catch (err) {
        console.error("Parsing error:", err);
        res.status(500).json({ error: "Invalid JSON from Lokka", details: err.message });
      }
    }
  };

  lokka.stdout.on('data', onData);
});



//previously
// app.post('/mcp', (req, res) => {
//   lokka.stdin.write(JSON.stringify(req.body) + '\n');

//   let buffer = '';

//   const onData = (chunk) => {
//     buffer += chunk.toString();
//     console.log('[Lokka Raw Output]', buffer); // Log raw output

//     // Lokka outputs one JSON per line
//     if (buffer.includes('\n')) {
//       lokka.stdout.off('data', onData);

//       try {
//         const parsed = JSON.parse(buffer.trim());
//         res.json(parsed);
//       } catch (err) {
//         res.status(500).json({ error: "Invalid JSON from Lokka", details: err.message });
//       }
//     }
//   };


//   lokka.stdout.on('data', onData);
// });


// app.post('/mcp', (req, res) => {
//   lokka.stdin.write(JSON.stringify(req.body) + '\n');
//   lokka.stdout.once('data', (data) => {
//     res.send(data.toString());
//   });
// });


app.get('/', (req, res) => {
  res.send('Lokka MCP Server is running. Use POST /mcp to send requests.');
});

const port = process.env.PORT || 3005;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

//some changes