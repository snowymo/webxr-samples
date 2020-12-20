import { mat4, vec3, quat } from '../render/math/gl-matrix.js';

// vars
window.localUuid = "";
// window.localStream;
window.peerConnections = {}; // key is uuid, values are peer connection object and user defined display name string
window.remoteIDs = [];
// const AudioContext = window.AudioContext || window.webkitAudioContext;
var peerConnectionConfig = {
    'iceServers': [
        { 'urls': 'stun:stun.stunprotocol.org:3478' },
        { 'urls': 'stun:stun.l.google.com:19302' },
    ]
};

function setUserMediaVariable() {

    if (navigator.mediaDevices === undefined) {
        navigator.mediaDevices = {};
    }

    navigator.mediaDevices.enumerateDevices()
        .then(function (devices) {
            devices.forEach(function (device) {
                console.log(device.kind + ": " + device.label +
                    " id = " + device.deviceId);
            });
        })

    if (navigator.mediaDevices.getUserMedia === undefined) {
        navigator.mediaDevices.getUserMedia = function (constraints) {

            // gets the alternative old getUserMedia is possible
            var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

            // set an error message if browser doesn't support getUserMedia
            if (!getUserMedia) {
                return Promise.reject(new Error("Unfortunately, your browser does not support access to the webcam through the getUserMedia API. Try to use the latest version of Google Chrome, Mozilla Firefox, Opera, or Microsoft Edge instead."));
            }

            // uses navigator.getUserMedia for older browsers
            return new Promise(function (resolve, reject) {
                getUserMedia.call(navigator, constraints, resolve, reject);
            });
        }
    }
}

window.webrtc_start = function () {
    window.localUuid = window.avatars[window.playerid].localUuid;
    // specify audio for user media
    // window.maxVideoWidth = 320;
    var constraints = {
        audio: true,
    };

    // setUserMediaVariable();

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

window.mute = function (peerUuid = window.localUuid) {
    // or unmute
    if (peerUuid == window.localUuid) {
        console.log('local', window.localUuid);
        for (let id in window.avatars) {
            console.log(window.avatars[id].localUuid);
        }
    } else {
        var hasAudio = false;
        console.log(peerUuid, window.peerConnections, window.peerConnections[peerUuid]);
        window.peerConnections[peerUuid].pc.streams.forEach((stream) => {
            stream.getTracks().forEach((t) => {
                if (t.kind === 'audio') {
                    t.enabled = !t.enabled;
                    hasAudio = t.enabled;
                    return hasAudio;
                }
            });
        });

        return hasAudio;
    }

}

function gotIceCandidate(event, peerUuid) {
    if (event.candidate != null) {
        window.wsclient.send("webrtc", { 'ice': event.candidate, 'uuid': window.localUuid, 'dest': peerUuid });
    }
}

function createdDescription(description, peerUuid) {
    console.log(`got description, peer ${peerUuid}`);
    if ("localdesc" in window.peerConnections[peerUuid]) {
        console.log("already set local description");
    } else {
        window.peerConnections[peerUuid].localdesc = true;
        window.peerConnections[peerUuid].pc.setLocalDescription(description).then(function () {
            window.wsclient.send("webrtc", { 'sdp': window.peerConnections[peerUuid].pc.localDescription, 'uuid': window.localUuid, 'dest': peerUuid });
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

    var vidElement = document.createElement('video');
    vidElement.setAttribute('autoplay', '');
    vidElement.setAttribute('muted', '');
    vidElement.srcObject = event.streams[0];
    vidElement.onloadedmetadata = function (e) {
        vidElement.muted = true;
    };

    playAvatarAudio(event.streams[0], peerUuid);


    var vidContainer = document.createElement('div');
    vidContainer.setAttribute('id', 'remoteAudio_' + peerUuid);
    // vidContainer.appendChild(vidElement);

    var videosElement = document.getElementById('audios');
    if (videosElement == null) {
        videosElement = document.createElement('div');
        videosElement.setAttribute("id", "audios");
        document.body.appendChild(videosElement);
    }

    document.getElementById('audios').appendChild(vidContainer);
}

function playAvatarAudio(stream, peerUuid) {
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

    // listener: where I am
    console.log("set listener pos", window.avatars[window.playerid].headset.position);
    window.peerConnections[peerUuid].audioContext.listener.setPosition(
        window.avatars[window.playerid].headset.position[0],
        window.avatars[window.playerid].headset.position[1],
        window.avatars[window.playerid].headset.position[2]);
    var rotation = window.avatars[window.playerid].headset.orientation;
    var fwd = vec3.create();
    quat.getEuler(fwd, rotation);
    window.peerConnections[peerUuid].audioContext.listener.forwardY.value = fwd[1];

    console.log('src', window.avatars[window.playerid].headset.position, fwd,
        'des', window.peerConnections[peerUuid].audioContext.listener.positionX, 
        window.peerConnections[peerUuid].audioContext.listener.positionY,
        window.peerConnections[peerUuid].audioContext.listener.positionZ,
        window.peerConnections[peerUuid].audioContext.listener.forwardY);
    // 0.1, 0, 0);
    // that.audioContext.listener.orientationY(0);
    // that.audioContext.listener.orientationZ(-1);

    // panner: audio source
    var pos = vec3.create();
    var orientation = quat.create();
    mat4.getTranslation(pos, window.avatars[window.peerConnections[peerUuid].displayName].headset.matrix);
    mat4.getRotation(orientation, window.avatars[window.peerConnections[peerUuid].displayName].headset.matrix);
    var euler = vec3.create();
    quat.getEuler(euler, orientation);
    window.peerConnections[peerUuid].panner = new PannerNode(window.peerConnections[peerUuid].audioContext, {
        // equalpower or HRTF
        panningModel: 'HRTF',
        // linear, inverse, exponential
        distanceModel: 'linear',
        positionX: pos[0],
        positionY: pos[1],
        positionZ: pos[2],
        orientationX: 0.0,
        orientationY: euler[1],
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
        // delete connection_uids[peerUuid];
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