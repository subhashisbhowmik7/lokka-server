const express = require('express');
const bodyParser = require('body-parser');
const { spawn } = require('child_process');

const app = express();
app.use(bodyParser.json());

let cachedTools = [];
let toolsCacheTimestamp = null;
let lokkaReady = false;

const lokka = spawn('cmd', ['/c', 'npx', '-y', '@merill/lokka'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    TENANT_ID: process.env.TENANT_ID,
    CLIENT_ID: process.env.CLIENT_ID,
    CLIENT_SECRET: process.env.CLIENT_SECRET
  }
});

// Function to send request to Lokka and get response
function sendLokkaRequest(requestBody) {
  return new Promise((resolve, reject) => {
    if (!lokkaReady) {
      reject(new Error('Lokka is not ready yet'));
      return;
    }

    lokka.stdin.write(JSON.stringify(requestBody) + '\n');

    let buffer = '';
    const timeout = setTimeout(() => {
      reject(new Error('Request timeout'));
    }, 10000);

    const onData = (chunk) => {
      buffer += chunk.toString();
      // console.log('[Lokka Raw Output]', buffer);

      if (buffer.includes('\n')) {
        clearTimeout(timeout);
        lokka.stdout.off('data', onData);

        try {
          const parsed = JSON.parse(buffer.trim());
          resolve(parsed);
        } catch (err) {
          console.error("Parsing error:", err);
          reject(new Error(`Invalid JSON from Lokka: ${err.message}`));
        }
      }
    };

    lokka.stdout.on('data', onData);
  });
}

// Function to fetch tools from Lokka dynamically
async function fetchToolsFromLokka() {
  try {
    console.log('🔍 Fetching tools from Lokka...');
    
    const toolsRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    };

    const response = await sendLokkaRequest(toolsRequest);
    
    if (response.result && response.result.tools) {
      cachedTools = response.result.tools;
      toolsCacheTimestamp = new Date().toISOString();
      
      console.log('✅ Successfully fetched tools from Lokka:');
      cachedTools.forEach((tool, index) => {
        console.log(`${index + 1}. ${tool.name}`);
      });
      
      return cachedTools;
    } else {
      console.log('❌ No tools found in Lokka response:', response);
      throw new Error('No tools found in response');
    }
  } catch (error) {
    console.error('❌ Error fetching tools from Lokka:', error.message);
    throw error;
  }
}

// Initialize Lokka and wait for it to be ready
function initializeLokka() {
  return new Promise((resolve) => {
    // Wait for Lokka to be ready (usually takes a few seconds)
    console.log('⏳ Waiting for Lokka to initialize...');
    
    setTimeout(async () => {
      lokkaReady = true;
      console.log('✅ Lokka is ready');
      //set a delay before fetching tools
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      try {
        await fetchToolsFromLokka();
        resolve();
      } catch (error) {
        console.error('❌ Failed to fetch initial tools:', error.message);
        resolve(); // Still resolve to start the server
      }
    }, 3000); // Wait 3 seconds for Lokka to initialize
  });
}

// Endpoint to get all available tools (fetched from Lokka)
app.get('/tools', async (req, res) => {
  try {
    // If cache is empty or older than 60 minutes, refresh from Lokka
    const cacheAge = toolsCacheTimestamp ? Date.now() - new Date(toolsCacheTimestamp).getTime() : Infinity;
    const shouldRefresh = cachedTools.length === 0 || cacheAge > 60 * 60 * 1000; // 60 minutes

    if (shouldRefresh) {
      console.log('🔄 Refreshing tools cache...');
      await fetchToolsFromLokka();
    }

    res.json({
      success: true,
      message: "Available Lokka tools (fetched dynamically)",
      tools: cachedTools,
      count: cachedTools.length,
      cacheTimestamp: toolsCacheTimestamp,
      cacheAge: cacheAge
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch tools from Lokka",
      details: error.message,
      cachedTools: cachedTools.length > 0 ? cachedTools : undefined
    });
  }
});

// Force refresh tools from Lokka
app.post('/tools/refresh', async (req, res) => {
  try {
    //timestamp
    console.log('🔄 Force refreshing tools from Lokka... {}')
    await fetchToolsFromLokka();
    
    res.json({
      success: true,
      message: "Tools refreshed successfully from Lokka",
      tools: cachedTools,
      count: cachedTools.length,
      timestamp: toolsCacheTimestamp
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to refresh tools from Lokka",
      details: error.message
    });
  }
});

// Get specific tool by name
app.get('/tools/:toolName', (req, res) => {
  const { toolName } = req.params;
  const tool = cachedTools.find(t => t.name === toolName);
  
  if (!tool) {
    return res.status(404).json({
      success: false,
      error: `Tool '${toolName}' not found`,
      availableTools: cachedTools.map(t => t.name),
      suggestion: "Try POST /tools/refresh to update the tools list"
    });
  }
  
  res.json({
    success: true,
    tool: tool,
    cacheTimestamp: toolsCacheTimestamp
  });
});

// Get only tool names (lightweight)
app.get('/tools/names', (req, res) => {
  res.json({
    success: true,
    toolNames: cachedTools.map(t => t.name),
    count: cachedTools.length,
    cacheTimestamp: toolsCacheTimestamp
  });
});

// Cache status endpoint
app.get('/tools/cache/status', (req, res) => {
  const cacheAge = toolsCacheTimestamp ? Date.now() - new Date(toolsCacheTimestamp).getTime() : null;
  
  res.json({
    success: true,
    cacheStatus: {
      toolsCount: cachedTools.length,
      lastUpdated: toolsCacheTimestamp,
      ageMs: cacheAge,
      ageMinutes: cacheAge ? Math.floor(cacheAge / 1000 / 60) : null,
      lokkaReady: lokkaReady
    }
  });
});


app.post('/mcp', (req, res) => {
  console.log('📤 MCP request received');
  lokka.stdin.write(JSON.stringify(req.body) + '\n');

  let buffer = '';

  const onData = (chunk) => {
    buffer += chunk.toString();
    //console.log('[Lokka Raw Output]', buffer);

    // Process once we see a newline (Lokka outputs line-delimited JSON)
    if (buffer.includes('\n')) {
      lokka.stdout.off('data', onData);

      try {
        const parsed = JSON.parse(buffer.trim());

        // ✅ Case 1: Direct tool result (like Lokka-Microsoft)
        if (parsed.result && !parsed.result.content) {
          console.log('✅ Case 1: Direct tool result');
          return res.json({
            message: "Direct tool result",
            data: parsed.result
          });
        }

        // ✅ Case 2: Wrapped in LLM content (Claude/OpenAI style)
        const rawText = parsed?.result?.content?.[0]?.text ?? '';
        const match = rawText.match(/\{[\s\S]*\}/);

        if (match) {
          const extracted = JSON.parse(match[0]);
          return res.json({
            message: "Graph API result (extracted)",
            data: extracted
          });
        }

        // Fallback → return raw parsed JSON
        return res.json({
          message: "Raw Lokka response",
          data: parsed
        });

      } catch (err) {
        console.error("Parsing error:", err);
        return res.status(500).json({
          error: "Invalid JSON from Lokka",
          details: err.message,
          raw: buffer
        });
      }
    }
  };

  lokka.stdout.on('data', onData);
});



// Original MCP endpoint for actual requests
// app.post('/mcp', (req, res) => {
//   console.log('📤 MCP request received');
//   lokka.stdin.write(JSON.stringify(req.body) + '\n');

//   let buffer = '';

//   const onData = (chunk) => {
//     console.log('📥 MCP response chunk received :: onData');
//     buffer += chunk.toString();
//     console.log('[Lokka Raw Output]', buffer);

//     if (buffer.includes('\n')) {
//       lokka.stdout.off('data', onData);

//       try {
//         const parsed = JSON.parse(buffer.trim());
//         const rawText = parsed?.result?.content?.[0]?.text ?? '';
//         const match = rawText.match(/\{[\s\S]*\}/);
        
//         if (!match) {
//           return res.json({ message: "No JSON found in response", raw: rawText });
//         }

//         const extracted = JSON.parse(match[0]);
//         return res.json({
//           message: "Graph API result",
//           data: extracted
//         });

//       } catch (err) {
//         console.error("Parsing error:", err);
//         res.status(500).json({ error: "Invalid JSON from Lokka", details: err.message });
//       }
//     }
//   };

//   lokka.stdout.on('data', onData);
// });

app.get('/', (req, res) => {
  res.json({
    message: 'Lokka MCP Server is running',
    endpoints: {
      'GET /tools': 'Get all available tools (dynamically fetched from Lokka)',
      'POST /tools/refresh': 'Force refresh tools from Lokka',
      'GET /tools/names': 'Get only tool names (lightweight)',
      'GET /tools/:toolName': 'Get specific tool details',
      'GET /tools/cache/status': 'Check cache status',
      'POST /mcp': 'Send MCP requests to Lokka'
    },
    status: {
      lokkaReady: lokkaReady,
      toolsCount: cachedTools.length,
      cacheTimestamp: toolsCacheTimestamp
    }
  });
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('Shutting down...');
  lokka.kill();
  process.exit();
});

// Initialize everything
initializeLokka().then(() => {
  const port = process.env.PORT || 3005;
  app.listen(port, () => {
    console.log(`🚀 Server listening on port ${port}`);
    console.log(`📋 ${cachedTools.length} tools cached from Lokka`);
  });
});