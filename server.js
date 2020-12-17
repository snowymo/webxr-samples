const fs = require('fs');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const DataStore = require("./DataStore.js");
const util = require("util");

// const yargs = require('yargs');
// based on examples at https://www.npmjs.com/package/ws 
const WebSocketServer = WebSocket.Server;

var env = "local";
var port = 2000;

// Yes, TLS is required
const serverConfig = env == "local" ?
    {
        key: fs.readFileSync('key.pem'),
        cert: fs.readFileSync('cert.pem'),
    } : {
        key: fs.readFileSync('/www/server/panel/vhost/cert/eye.3dvar.com/privkey.pem'),
        cert: fs.readFileSync('/www/server/panel/vhost/cert/eye.3dvar.com/fullchain.pem'),
    };

// ----------------------------------------------------------------------------------------

// Create a server for the client html page
const handleRequest = function (request, response) {
    // Render the single client html file for any request the HTTP server receives
    // console.log('request received: ' + request.url);
    if (request.url.endsWith('.png')) {
        if (!request.url.startsWith('.')) {
            request.url = "." + request.url;
        }
        // console.log('request received: ' + request.url);
        response.writeHead(200, { 'Content-Type': 'image/png' });
        response.end(fs.readFileSync(request.url));
    } else if (request.url.endsWith('.gif')) {
        response.writeHead(200, { 'Content-Type': 'image/gif' });
        response.end(fs.readFileSync(request.url));
    }
    else if (request.url.endsWith(".fbx")) {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end(fs.readFileSync(request.url));
    } else if (request.url.endsWith(".js")) {
        response.writeHead(200, { 'Content-Type': 'application/javascript' });
        if (request.url.includes("../")) {
            response.end(fs.readFileSync(request.url.replace('../', '')));
        } else {
            if (!request.url.startsWith('.')) {
                request.url = "." + request.url;
            }
            // console.log('request received: ' + request.url);
            response.end(fs.readFileSync(request.url));
        }
    } else if (request.url.endsWith('.css')) {
        if (!request.url.startsWith('.')) {
            request.url = "." + request.url;
        }
        // console.log('request received: ' + request.url);
        response.writeHead(200, { 'Content-Type': 'text/css' });
        response.end(fs.readFileSync(request.url));
    } else if (request.url.endsWith('.ogg')) {
        if (!request.url.startsWith('.')) {
            request.url = "." + request.url;
        }
        // console.log('request received: ' + request.url);
        response.writeHead(200, { 'Content-Type': 'audio/ogg' });
        response.end(fs.readFileSync(request.url));
    } else if (request.url.endsWith('.svg')) {
        if (!request.url.startsWith('.')) {
            request.url = "." + request.url;
        }
        // console.log('request received: ' + request.url);
        response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        response.end(fs.readFileSync(request.url));
    } else if (request.url.endsWith('.html')) {
        if (!request.url.startsWith('.')) {
            request.url = "." + request.url;
        }
        // console.log('request received: ' + request.url);
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(fs.readFileSync(request.url));
    }
    else if (request.url == '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(fs.readFileSync("./index.html"));
    }
    else {
        if (!request.url.startsWith('.')) {
            request.url = "." + request.url;
        }
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end(fs.readFileSync(request.url));
    }
};

var HTTPS_PORT = port; //default port for https is 443
var HTTP_PORT = HTTPS_PORT - 442; //default port for http is 80
const httpsServer = https.createServer(serverConfig, handleRequest);
httpsServer.listen(HTTPS_PORT);
// console.log("httpsServer:", httpsServer);
// ----------------------------------------------------------------------------------------

// Create a server for handling websocket calls
const wss =
    // argv.env == "local" ? new WebSocketServer({ port: 3448 }) : 
    new WebSocketServer({ server: httpsServer });
// console.log("wss:" + wss.options.host + "-" + wss.options.path + ":" + wss.options.port);

let wsIndex = 0;
let websocketMap = new Map();
const datastore = new DataStore();
let avatars = {};
let timers = {};
const AVATAR_RATE = 16;
setInterval(() => {
    console.log("current connections:");
    console.log(Array.from(websocketMap.keys()));
    console.log("avatars: ");
    // console.log(avatars);
    for(let id in avatars){
        console.log("id", id, "pos_x:");
        console.log(avatars[id]["state"]["mtx"]['12']);
    }
    
}, 5000);

function send(to, from, message) {
    if (to == "*") {
        // send to all
        wss.clients.forEach(function each(client) {
            // console.log("send ", client.index, client.isAlive, client.readyState);
            if (from == client.index) {
                return;
            }

            if (client.readyState === WebSocket.OPEN) {
                // console.log('\tsend to', client.index, 'message:' + util.inspect(message["type"], {showHidden: false, depth: null}));//util.inspect(entry["message"], {showHidden: false, depth: null})
                client.send(JSON.stringify(message));
            } else if (client.readyState === WebSocket.CLOSING) {
                console.log("ws not open:", client.index, message);
            } else if (client.readyState === WebSocket.CLOSED) {
                console.log("ws not open:", client.index, message);
            } else if (client.readyState === WebSocket.CONNECTING) {
                console.log("ws not open:", client.index, message);
            }
        });

    } else {
        console.log("sending to:", to);
        const dst = websocketMap.get(to);
        if (dst) {
            dst.send(JSON.stringify(message));
        }
    }
}

function leave(index, username) {
    console.log("close: websocketMap.keys():", Array.from(websocketMap.keys()));
    if (!websocketMap.get(index)) {
        return;
    }

    delete avatars[index];
    console.log(avatars);
    // clearInterval(timerID);
    // TODO: change ip to username
    console.log(index);
    const response = { "type": "leave", "user": index };
    send("*", index, response);
    websocketMap.get(index).close();
    websocketMap.delete(index);
}

wss.on('connection', function (ws, req) {
    ws.index = wsIndex++;
    websocketMap.set(ws.index, ws);
    console.log("connection:", req.connection.remoteAddress, ws.index);
    const payload = { "type": "initialize", "id": ws.index, "objects": datastore.state["objects"], "avatars": avatars };
    send(ws.index, -1, payload);

    // notify the world that a player joined, should be a separate process from initialize
    // TODO: change id to username or something
    send("*", -1, { "type": "join", "id": ws.index });

    ws.on('message', function (data) {
        // Broadcast any received message to all clients
        //wss.broadcast(message);

        // deal with it according to different msg
        // console.log(data);
        let json = {};
        try {
            json = JSON.parse(data.toString());
        } catch (err) {
            // console.log(err);
            return;
        }
        switch (json["type"]) {
            case "object":{
                const key = json["uid"];
                const lockid = json["lockid"];
                const state = json["state"];

                if (datastore.acquire(key, lockid)) {
                    datastore.setObjectData(key, state);
                    // console.log(datastore.state);

                    // tell everyone else about this update
                    const response = {
                        "type": "object",
                        "uid": key,
                        "state": state,
                        "lockid": lockid,
                        "success": true
                    };

                    send("*", -1, response);
                } else {
                    // respond to sender only with failure, only need to indicate what uid is
                    const response = {
                        "type": "object",
                        "uid": key,
                        "success": false
                    };

                    send(ws.index, -1, response);
                    console.log("object in use.");
                }
                break;
            }                
            case "avatar":
                {
                    // console.log("receive avatar msg");
                    // console.log(json);
                    const userid = json["user"];
                    const state = json["state"];
                    // console.log("userid", userid);
    
                    avatars[userid] = {
                        'user': userid,
                        'state': state
                    };
                    // console.log(avatars);
                    break;
                }                
            default:
                break;
        }

        timers["avatar"] = setInterval(() => {

            if (Object.keys(avatars).length === 0) {
                return;
            }
            // zhenyi
            const response = {
                "type": "avatar",
                "data": avatars
            };
            // console.log("timers[avatar] ", avatars);
            send("*", -1, response);
        }, AVATAR_RATE);
    });

    ws.on('error', () => ws.terminate());

    ws.on("close", () => {
        console.log(".");
        leave(ws.index);
    });
});

wss.broadcast = function (data) {
    this.clients.forEach(function (client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
};

console.log('Server running with port ' + HTTPS_PORT);

// ----------------------------------------------------------------------------------------

// Separate server to redirect from http to https
http.createServer(function (req, res) {
    console.log(req.headers['host'] + req.url);
    res.writeHead(301, { "Location": "https://" + req.headers['host'] + req.url });
    res.end();
}).listen(HTTP_PORT);