const fs = require('fs');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
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
    console.log('request received: ' + request.url);
    if (request.url.endsWith('.png')) {
        if (!request.url.startsWith('.')) {
            request.url = "." + request.url;
        }
        console.log('request received: ' + request.url);
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
            // console.log("debug:" + request.url.replace('../', ''));
            response.end(fs.readFileSync(request.url.replace('../', '')));
        } else {
            // console.log("\tdebug:" + 'client' + request.url);
            if (!request.url.startsWith('.')) {
                request.url = "." + request.url;
            }
            console.log('request received: ' + request.url);
            response.end(fs.readFileSync(request.url));
        }
    } else if (request.url.endsWith('.css')) {
        if (!request.url.startsWith('.')) {
            request.url = "." + request.url;
        }
        console.log('request received: ' + request.url);
        response.writeHead(200, { 'Content-Type': 'text/css' });
        response.end(fs.readFileSync(request.url));
    } else if (request.url.endsWith('.ogg')) {
        if (!request.url.startsWith('.')) {
            request.url = "." + request.url;
        }
        console.log('request received: ' + request.url);
        response.writeHead(200, { 'Content-Type': 'audio/ogg' });
        response.end(fs.readFileSync(request.url));
    } else if (request.url.endsWith('.svg')) {
        if (!request.url.startsWith('.')) {
            request.url = "." + request.url;
        }
        console.log('request received: ' + request.url);
        response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        response.end(fs.readFileSync(request.url));
    } else if (request.url.endsWith('.html')) {
        if (!request.url.startsWith('.')) {
            request.url = "." + request.url;
        }
        console.log('request received: ' + request.url);
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(fs.readFileSync(request.url));
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

wss.on('connection', function (ws) {
    // specify host addr
    //   wss.broadcast(JSON.stringify({ 'viz': viz, 'uuid': 'server', 'dest': 'all' }));

    ws.on('message', function (message) {
        // Broadcast any received message to all clients
        wss.broadcast(message);
    });

    ws.on('error', () => ws.terminate());
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