const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;

async function notification(method, params) {
  console.log('method:', method);
  console.log('params:');
  console.log(JSON.stringify(params, null, '  '));

  /* ENTER YOUR INTEGRATION CODE HERE */
  /* method contains the event type e.g. vulnerability-created */
  /* params contains the event body e.g. JSON object with timestamp & vulnerability details */
}

async function main() {
  await connect();
}

async function connect() {
  if (process.env.HOSTNAME === undefined) {
    console.error('Environment variable HOSTNAME is undefined');
    process.exit(1);
  }

  if (process.env.EVENTS === undefined) {
    console.error('Environment variable EVENTS is undefined');
    process.exit(1);
  }

  if (process.env.X_SSAPI_KEY === undefined) {
    console.error('Environment variable X_SSAPI_KEY is undefined');
    process.exit(1);
  }

  let port = 443;

  if (process.env.PORT !== undefined) {
    port = process.env.PORT;
  }

  const ws = new WebSocket(`wss://${process.env.HOSTNAME}:${port}/api/ss/events`, undefined, {
    headers: {
      'X-SSAPI-KEY': process.env.X_SSAPI_KEY
    },
  });

  ws.on('error', (error) => {
    console.error(error);
  });

  ws.on('close', () => {
    clearTimeout(this.heartbeatTimeout);

    setTimeout(() => {
      connect();
    }, 1000)
  });

  ws.on('message', async function(data) {
    try {
      const payload = JSON.parse(data);

      if (payload.jsonrpc === '2.0') {
        if ('method' in payload && !('id' in payload)) {
          if (payload.params && payload.params.timestamp) {
            storeReplayTimestamp(payload.params.timestamp);
          }

          await notification.call(this, payload.method, payload.params);
        }
        else if ('method' in payload && 'id' in payload) {
          if (payload.method === 'heartbeat') {
            this.send(JSON.stringify({
              jsonrpc: "2.0",
              result: new Date().toISOString(),
              id: payload.id
            }));

            await heartbeat.call(this);
          }
        }
        else if ('result' in payload && 'id' in payload) {
          if (payload.id in this.pendingRequests) {
            clearTimeout(this.pendingRequests[payload.id].timeout);
            this.pendingRequests[payload.id].success(payload.result, payload.id);
          }
        }
        else if ('error' in payload && 'id' in payload) {
          if (payload.id in this.pendingRequests) {
            clearTimeout(this.pendingRequests[payload.id].timeout);
            this.pendingRequests[payload.id].failure(payload.error, payload.id);
          }
        }
        else {
          console.error('unsupported message format')
        }
      }
    }
    catch (err) {
      console.error('error parsing message');
      console.error(err);
    }
  });

  ws.on('open', async function() {
    this.pendingRequests = {};

    await heartbeat.call(this);
    await subscribe.call(this);
  });
}

async function heartbeat() {
  clearTimeout(this.heartbeatTimeout);

  this.heartbeatTimeout = setTimeout(() => {
    this.terminate();
  }, 30000 + 1000);
}

async function loadReplayTimestamp() {
  let filehandle;
  let timestamp = new Date().toISOString();

  try {
    filehandle = await fs.open('.replay_timestamp', 'r');
    const result = await filehandle.read(Buffer.alloc(24), 0, 24, 0);

    if (result.bytesRead === 24) {
      timestamp = result.buffer.toString();
      console.log('Loaded replay timestamp from storage:', timestamp);
    }
    else {
      console.log('Invalid timestamp stored in ".replay_timestamp"');
    }
  }
  catch {
    if (process.env.FROM) {
      console.log('Loaded replay timestamp from environment:', process.env.FROM);
      timestamp = process.env.FROM;
    }
  }
  finally {
    if (filehandle !== undefined) {
      await filehandle.close();
    }

    return timestamp;
  }
}

async function storeReplayTimestamp(timestamp) {
  let filehandle;

  try {
    filehandle = await fs.open('.replay_timestamp', 'w');
    await filehandle.write(Buffer.from(timestamp), 0, 24, 0);
  }
  catch (err) {
    console.error(err);
  }
  finally {
    if (filehandle !== undefined) {
      await filehandle.close();
    }
  }
}

async function subscribe() {
  const events = process.env.EVENTS.split(',').map(x => x.trim());

  const request = {
    jsonrpc: "2.0",
    method: "subscribe",
    params: {
      events: events,
      from: await loadReplayTimestamp()
    },
    id: uuidv4().toString()
  }

  this.pendingRequests[request.id] = {
    request: request,
    success: (result, id) => {
      console.log('Subscribed to the following events:', result);

      delete this.pendingRequests[request.id];
    },
    failure: (error, id) => {
      console.log(`Subscription request ${id} failed - exiting`);
      console.log(error);

      delete this.pendingRequests[request.id];

      process.exit(1);
    },
    timeout: setTimeout(() => {
      console.log(`Subscription request ${request.id} timed out - exiting`);

      delete this.pendingRequests[request.id];

      process.exit(1);
    }, 5000)
  };

  this.send(JSON.stringify(request));
}

main().catch((err) => {
  console.error(err);
});

