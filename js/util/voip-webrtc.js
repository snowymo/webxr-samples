import { mat4, vec3 } from '../render/math/gl-matrix.js';

// vars
window.localUuid = "";
// window.localStream;
window.peerConnections = {}; // key is uuid, values are peer connection object and user defined display name string
window.remoteIDs = [];
var peerConnectionConfig = {
    'iceServers': [
        { 'urls': 'stun:stun.stunprotocol.org:3478' },
        { 'urls': 'stun:stun.l.google.com:19302' },
    ]
};

window.webrtc_start = function () {
    window.localUuid = window.avatars[window.playerid].localUuid;
    // specify audio for user media
    // window.maxVideoWidth = 320;
    var constraints = {
        audio: true,
    };

    if (navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia(constraints)
            .then(stream => {
                // window.videoStream = stream;
                window.localStream = stream;
                // stream.getAudioTracks()[0].enabled = false;
                document.getElementById('local_webrtc').muted = true;
                document.getElementById('local_webrtc').srcObject = stream;
                window.avatars[window.playerid].audio = document.getElementById("local_webrtc");
                // update to global
                // window.localStreamReady = true;
                // hide the self video until calibration is finished
                // document.getElementById('localVideoContainer').style.display = 'none';
            }).catch(errorHandler)

            // set up websocket and message all existing clients
            .then(() => {
                // window.serverConnection.onmessage = gotMessageFromServer;
                // window.serverConnection.onopen = event => {
                //     window.serverConnection.send(JSON.stringify({ 'displayName': window.localDisplayName, 'uuid': window.localUuid, 'dest': 'all' }));
                // }
                window.wsclient.send("webrtc", { 'displayName': window.playerid, 'uuid': window.localUuid, 'dest': 'all' });
            }).catch(errorHandler);

    } else {
        alert('Your browser does not support getUserMedia API');
    }
}

function setUpPeer(peerUuid, displayName, initCall = false) {
    window.peerConnections[peerUuid] = { 'displayName': displayName, 'pc': new RTCPeerConnection(peerConnectionConfig) };
    window.peerConnections[peerUuid].pc.onicecandidate = event => gotIceCandidate(event, peerUuid);
    window.peerConnections[peerUuid].pc.ontrack = event => gotRemoteStream(event, peerUuid);
    window.peerConnections[peerUuid].pc.oniceconnectionstatechange = event => checkPeerDisconnect(event, peerUuid);
    if (window.localStream)
        window.peerConnections[peerUuid].pc.addStream(window.localStream);

    if (initCall) {
        window.peerConnections[peerUuid].pc.createOffer().then(description => createdDescription(description, peerUuid)).catch(errorHandler);
    }
}
window.setUpPeer = setUpPeer;

function gotIceCandidate(event, peerUuid) {
    if (event.candidate != null) {
        window.wsclient.send("webrtc", { 'ice': event.candidate, 'uuid': window.localUuid, 'dest': peerUuid });
    }
}

function createdDescription(description, peerUuid) {
    console.log(`got description, peer ${peerUuid}`);
    if("localdesc" in window.peerConnections[peerUuid]){
        console.log("already set local description");
    }else{
        window.peerConnections[peerUuid].localdesc = true;
        window.peerConnections[peerUuid].pc.setLocalDescription(description).then(function () {
            window.wsclient.send("webrtc", {'sdp': window.peerConnections[peerUuid].pc.localDescription, 'uuid': window.localUuid, 'dest': peerUuid });
        }).catch(errorHandler);
    }    
}
window.createdDescription = createdDescription;

function gotRemoteStream(event, peerUuid) {
    // if (peerUuid in connection_uids) {
    //     return;
    // }
    // connection_uids[peerUuid] = true;
    console.log(`got remote stream, peer ${peerUuid}`);
    playAudio(event.streams[0], peerUuid);

    var vidElement = document.createElement('video');
  vidElement.setAttribute('autoplay', '');
  // vidElement.setAttribute('muted', '');
  vidElement.srcObject = event.streams[0];
  vidElement.style.display = 'none';

  var vidContainer = document.createElement('div');
  vidContainer.setAttribute('id', 'remoteAudio_' + peerUuid);
  vidContainer.appendChild(vidElement);

  document.getElementById('audios').appendChild(vidContainer);
}

function playAudio(stream, peerUuid) {
    // 
    if (initAudio(peerUuid)) {
        // how many times this got called?
        // shall we update listener here?
        // Create a MediaStreamAudioSourceNode
        var realAudioInput = new MediaStreamAudioSourceNode(window.peerConnections[peerUuid].audioContext, {
            mediaStream: stream
        });
        window.peerConnections[peerUuid].audioInputStream = realAudioInput;

        realAudioInput.connect(window.peerConnections[peerUuid].panner);
        window.peerConnections[peerUuid].panner.connect(window.peerConnections[peerUuid].audioContext.destination);
        // realAudioInput.connect(that.audioContext.destination);
        // realAudioInput.connect(that.biquadFilter);
        // that.biquadFilter.connect(that.audioContext.destination);    
    }
}

function initAudio(peerUuid) {
    if (window.peerConnections[peerUuid].audioContext != null) {
        console.log("avatar[" + window.peerConnections[peerUuid].displayName + "] already setup");
        return true;
    }

    if (!(window.peerConnections[peerUuid].displayName in window.avatars)) {
        console.log("avatar[" + window.peerConnections[peerUuid].displayName + "] is not ready yet", window.avatars);

        setTimeout(initAudio(peerUuid), 1000);
        return false;
    }

    console.log("avatar[" + window.peerConnections[peerUuid].displayName + "] now setting up");

    window.peerConnections[peerUuid].audioContext = new AudioContext({
        latencyHint: 'interactive',
        sampleRate: 44100,
    });

    var pos = vec3.create();
    mat4.getTranslation(pos, window.avatars[window.peerConnections[peerUuid].displayName].headset.matrix);
    window.peerConnections[peerUuid].audioContext.listener.setPosition(pos[0], pos[1], pos[2]
    );
    // 0.1, 0, 0);
    // that.audioContext.listener.orientationY(0);
    // that.audioContext.listener.orientationZ(-1);
    window.peerConnections[peerUuid].panner = new PannerNode(window.peerConnections[peerUuid].audioContext, {
        // equalpower or HRTF
        panningModel: 'HRTF',
        // linear, inverse, exponential
        distanceModel: 'exponential',
        positionX: 0.0,
        positionY: 0.1,
        positionZ: 0.0,
        orientationX: 1.0,
        orientationY: 0.0,
        orientationZ: 0.0,
        refDistance: .1,
        maxDistance: 10000,
        rolloffFactor: 1.5,
        coneInnerAngle: 360,
        coneOuterAngle: 360,
        coneOuterGain: 0.2
    });
    return true;
}

function checkPeerDisconnect(event, peerUuid) {
    var state = window.peerConnections[peerUuid].pc.iceConnectionState;
    console.log(`connection with peer ${peerUuid} ${state}`);
    if (state === "failed" || state === "closed" || state === "disconnected") {
        delete window.peerConnections[peerUuid];
        delete connection_uids[peerUuid];
    }
}

function errorHandler(error) {
    console.log(error);
}
window.errorHandler = errorHandler;

// Taken from http://stackoverflow.com/a/105074/515584
// Strictly speaking, it's not a real UUID, but it gets the job done here
function createUUID() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    }

    return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}