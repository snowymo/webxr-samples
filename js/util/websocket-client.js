"use strict"

import {ServerPublishSubscribe as evtPubSub} from "../primitive/event-pubsub.js";

// TODO: add ping pong heartbeart to keep connections alive
// TODO: finish automatic reconnection
// TODO: max retries + timeout

export class Client {
    constructor(heartbeat = 30000) {
        this.heartbeatTick = heartbeat;
        this.ws = null;
        this.subs = new evtPubSub();
    }

    // TODO: verify this is working
    heartbeat() {
        clearTimeout(this.pingTimeout);
        // Delay should be equal to the interval at which your server
        // sends out pings plus a conservative assumption of the latency.
        this.pingTimeout = setTimeout(() => {
        // this.close(); // i.e. revisit this...
        }, this.heartbeatTick + 1000);
    }

    // expected as a js object
    // TODO: add guaranteed delivery
    send(type, data) {
        let message;
        switch(type){
            case "avatar":
                message = {
                    type: "avatar",
                    user: data,
                    state: {
                        pos: window.avatars[data].headset.position,
                        rot: window.avatars[data].headset.orientation,
                        controllers: {
                            left: {
                                pos: window.avatars[data].leftController.position,
                                rot: window.avatars[data].leftController.orientation,
                            },
                            right: {  
                                pos: window.avatars[data].rightController.position,
                                rot: window.avatars[data].rightController.orientation,  
                            }
                        }
                    }
                };
                break;
                default:
                    break;
        }
       this.ws.send(JSON.stringify(message));
    }

    connect(ip, port) {
        try {            
            this.ws = new WebSocket('wss://' + ip + ':' + port);
            console.log('wss://' + ip + ':' + port);

            // function reconnect
            this.ws.onopen = () => {

                // this.heartbeat();
                // reset t, clean up later
                // this.t = 0;
                console.log('websocket is connected ...');
                this.subs.publish('open', null);
                if (this.ws.readyState == WebSocket.OPEN) {
                } else {
                }
                // ws.send('connected');
            };

            this.ws.onmessage = (ev) => {
                try {
                    // console.log(ev);
                    // const data = JSON.parse(ev.data);
                    // if (data.message_type) {
                    //     MR.server.subs.publish(data.message_type, data);
                    //     // MR.server.subsLocal.publish(data.message_type, data);
                    // }
                    let json = JSON.parse(ev.data);
                    window.EventBus.publish(json["type"], json);
                } catch(err) {
                    // console.log("bad json:", json);
                    console.error(err);
                }

            };
            this.ws.onclose = (event) => {
                switch (event.code) {
                    // CLOSE_NORMAL
                    case 1000:
                        console.log("WebSocket: closed");
                        break;
                    // Abnormal closure
                    default:
                        console.log('reconnecting...');
                        break;
                    }
                console.log("disconnected");
                clearTimeout(this.pingTimeout);
            };

            this.ws.onerror = (e) => {
                switch (e.code) {
                    case 'ECONNREFUSED':
                        console.error(e);
                        // reconnect(e);
                        this.ws.close();
                        break;
                    default:
                        // this.onerror(e);
                        break;
                }
            };

        } catch (err) {
            console.error("Couldn't load websocket", err);
        }
    }
};