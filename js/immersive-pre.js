import { WebXRButton } from './util/webxr-button.js';
import { Scene } from './render/scenes/scene.js';
import { Renderer, createWebGLContext } from './render/core/renderer.js';
import { UrlTexture } from './render/core/texture.js';
import { ButtonNode } from './render/nodes/button.js';
import { Gltf2Node } from './render/nodes/gltf2.js';
import { mat4, vec3 } from './render/math/gl-matrix.js';
import { Ray } from './render/math/ray.js';
import { InlineViewerHelper } from './util/inline-viewer-helper.js';
import { QueryArgs } from './util/query-args.js';
import { EventBus } from "./primitive/eventbus.js";
import * as DefaultSystemEvents from "./primitive/event.js";

// If requested, use the polyfill to provide support for mobile devices
// and devices which only support WebVR.
import WebXRPolyfill from './third-party/webxr-polyfill/build/webxr-polyfill.module.js';
if (QueryArgs.getBool('usePolyfill', true)) {
    let polyfill = new WebXRPolyfill();
}

const DEFAULT_HEIGHT = 1.5;
const ANALYSER_FFT_SIZE = 1024;

// XR globals.
let xrButton = null;
let xrImmersiveRefSpace = null;
let inlineViewerHelper = null;

// WebGL scene globals.
let gl = null;
let renderer = null;
let scene = new Scene();
scene.addNode(new Gltf2Node({ url: '../media/gltf/garage/garage.gltf' }));
scene.standingStats(true);

let playButton = null;
let playTexture = new UrlTexture('../media/textures/play-button.png');
let pauseTexture = new UrlTexture('../media/textures/pause-button.png');
let stereo = new Gltf2Node({ url: '../media/gltf/stereo/stereo.gltf' });
// FIXME: Temporary fix to initialize for cloning.
stereo.visible = false;
scene.addNode(stereo);

// Audio scene globals
let audioContext = new AudioContext();
let resonance = new ResonanceAudio(audioContext);
resonance.output.connect(audioContext.destination);

audioContext.suspend();

// TODO: This is crashing in recent versions of Resonance for me, and I'm
// not sure why. It does run succesfully without it, though.
// Rough room dimensions in meters (estimated from model in Blender.)
/*let roomDimensions = {
  width : 6,
  height : 3,
  depth : 6
};

// Simplified view of the materials that make up the scene.
let roomMaterials = {
  left : 'plywood-panel', // Garage walls
  right : 'plywood-panel',
  front : 'plywood-panel',
  back : 'metal', // To account for the garage door
  down : 'polished-concrete-or-tile', // garage floor
  up : 'wood-ceiling'
};
resonance.setRoomProperties(roomDimensions, roomMaterials);*/

function createAudioSource(options) {
    // Create a Resonance source and set its position in space.
    let source = resonance.createSource();
    let pos = options.position;
    source.setPosition(pos[0], pos[1], pos[2]);

    // Connect an analyser. This is only for visualization of the audio, and
    // in most cases you won't want it.
    let analyser = audioContext.createAnalyser();
    analyser.fftSize = ANALYSER_FFT_SIZE;
    analyser.lastRMSdB = 0;

    return fetch(options.url)
        .then((response) => response.arrayBuffer())
        .then((buffer) => audioContext.decodeAudioData(buffer))
        .then((decodedBuffer) => {
            let bufferSource = createBufferSource(
                source, decodedBuffer, analyser);

            return {
                buffer: decodedBuffer,
                bufferSource: bufferSource,
                source: source,
                analyser: analyser,
                position: pos,
                rotateY: options.rotateY,
                node: null
            };
        });
}

function createBufferSource(source, buffer, analyser) {
    // Create a buffer source. This will need to be recreated every time
    // we wish to start the audio, see
    // https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode
    let bufferSource = audioContext.createBufferSource();
    bufferSource.loop = true;
    bufferSource.connect(source.input);

    bufferSource.connect(analyser);

    bufferSource.buffer = buffer;

    return bufferSource;
}

/**
 * Returns a floating point value that represents the loudness of the audio
 * stream, appropriate for scaling an object with.
 * @return {Number} loudness scalar.
 */
let fftBuffer = new Float32Array(ANALYSER_FFT_SIZE);
function getLoudnessScale(analyser) {
    analyser.getFloatTimeDomainData(fftBuffer);
    let sum = 0;
    for (let i = 0; i < fftBuffer.length; ++i)
        sum += fftBuffer[i] * fftBuffer[i];

    // Calculate RMS and convert it to DB for perceptual loudness.
    let rms = Math.sqrt(sum / fftBuffer.length);
    let db = 30 + 10 / Math.LN10 * Math.log(rms <= 0 ? 0.0001 : rms);

    // Moving average with the alpha of 0.525. Experimentally determined.
    analyser.lastRMSdB += 0.525 * ((db < 0 ? 0 : db) - analyser.lastRMSdB);

    // Scaling by 1/30 is also experimentally determined. Max is to present
    // objects from disappearing entirely.
    return Math.max(0.3, analyser.lastRMSdB / 30.0);
}

let audioSources = [];

function updateAudioNodes() {
    if (!stereo)
        return;

    for (let source of audioSources) {
        if (!source.node) {
            source.node = stereo.clone();
            source.node.visible = true;
            source.node.selectable = true;
            scene.addNode(source.node);
        }

        let node = source.node;
        let matrix = node.matrix;

        // Move the node to the right location.
        mat4.identity(matrix);
        mat4.translate(matrix, matrix, source.position);
        mat4.rotateY(matrix, matrix, source.rotateY);

        // Scale it based on loudness of the audio channel
        let scale = getLoudnessScale(source.analyser);
        mat4.scale(matrix, matrix, [scale, scale, scale]);
    }
}

function playAudio() {
    if (audioContext.state == 'running')
        return;

    audioContext.resume();

    for (let source of audioSources) {
        source.bufferSource.start(0);
    }

    if (playButton) {
        playButton.iconTexture = pauseTexture;
    }
}

function pauseAudio() {
    if (audioContext.state == 'suspended')
        return;

    for (let source of audioSources) {
        source.bufferSource.stop(0);
        source.bufferSource = createBufferSource(
            source.source, source.buffer, source.analyser);
    }

    audioContext.suspend();

    if (playButton) {
        playButton.iconTexture = playTexture;
    }
}

window.addEventListener('blur', () => {
    // As a general rule you should mute any sounds your page is playing
    // whenever the page loses focus.
    pauseAudio();
});

function initXR() {
    xrButton = new WebXRButton({
        onRequestSession: onRequestSession,
        onEndSession: onEndSession
    });
    document.querySelector('header').appendChild(xrButton.domElement);

    if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
            xrButton.enabled = supported;
        });

        // Load multiple audio sources.
        Promise.all([
            createAudioSource({
                url: 'media/sound/guitar.ogg',
                position: [0, DEFAULT_HEIGHT, -1],
                rotateY: 0
            }),
            createAudioSource({
                url: 'media/sound/drums.ogg',
                position: [-1, DEFAULT_HEIGHT, 0],
                rotateY: Math.PI * 0.5
            }),
            createAudioSource({
                url: 'media/sound/perc.ogg',
                position: [1, DEFAULT_HEIGHT, 0],
                rotateY: Math.PI * -0.5
            }),
        ]).then((sources) => {
            audioSources = sources;

            // Once the audio is loaded, create a button that toggles the
            // audio state when clicked.
            playButton = new ButtonNode(playTexture, () => {
                if (audioContext.state == 'running') {
                    pauseAudio();
                } else {
                    playAudio();
                }
            });
            playButton.translation = [0, 1.2, -0.65];
            scene.addNode(playButton);
        });

        navigator.xr.requestSession('inline').then(onSessionStarted);
    }

    // custom init
    window.EventBus = new EventBus();
    window.objs = [];
    DefaultSystemEvents.init();
}

function initGL() {
    if (gl)
        return;

    gl = createWebGLContext({
        xrCompatible: true
    });
    document.body.appendChild(gl.canvas);

    function onResize() {
        gl.canvas.width = gl.canvas.clientWidth * window.devicePixelRatio;
        gl.canvas.height = gl.canvas.clientHeight * window.devicePixelRatio;
    }
    window.addEventListener('resize', onResize);
    onResize();

    renderer = new Renderer(gl);
    scene.setRenderer(renderer);

    // TODO: setup an Avartar class that contains head and hands position for conditionally rendering
    // Loads a generic controller meshes.
    scene.inputRenderer.setControllerMesh(new Gltf2Node({ url: 'media/gltf/controller/controller.gltf' }), 'right');
    scene.inputRenderer.setControllerMesh(new Gltf2Node({ url: 'media/gltf/controller/controller-left.gltf' }), 'left');
}

function onRequestSession() {
    return navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor']
    }).then((session) => {
        xrButton.setSession(session);
        session.isImmersive = true;
        onSessionStarted(session);
    });
}

function onSessionStarted(session) {
    session.addEventListener('end', onSessionEnded);

    session.addEventListener('selectstart', onSelectStart);
    session.addEventListener('selectend', onSelectEnd);
    session.addEventListener('select', (ev) => {
        let refSpace = ev.frame.session.isImmersive ?
            xrImmersiveRefSpace :
            inlineViewerHelper.referenceSpace;
        scene.handleSelect(ev.inputSource, ev.frame, refSpace);
    });

    initGL();
    // scene.inputRenderer.useProfileControllerMeshes(session);

    let glLayer = new XRWebGLLayer(session, gl);
    session.updateRenderState({ baseLayer: glLayer });

    let refSpaceType = session.isImmersive ? 'local-floor' : 'viewer';
    session.requestReferenceSpace(refSpaceType).then((refSpace) => {
        if (session.isImmersive) {
            xrImmersiveRefSpace = refSpace;
        } else {
            inlineViewerHelper = new InlineViewerHelper(gl.canvas, refSpace);
            inlineViewerHelper.setHeight(1.6);
        }

        session.requestAnimationFrame(onXRFrame);
    });
}

function onEndSession(session) {
    session.end();
}

function onSessionEnded(event) {
    if (event.session.isImmersive) {
        xrButton.setSession(null);

        // Stop the audio playback when we exit XR.
        pauseAudio();
    }
}

function updateInputSources(session, frame, refSpace) {
    for (let inputSource of session.inputSources) {
        let targetRayPose = frame.getPose(inputSource.targetRaySpace, refSpace);

        // We may not get a pose back in cases where the input source has lost
        // tracking or does not know where it is relative to the given frame
        // of reference.
        if (!targetRayPose) {
            continue;
        }

        // If we have a pointer matrix we can also use it to render a cursor
        // for both handheld and gaze-based input sources.

        // Statically render the cursor 2 meters down the ray since we're
        // not calculating any intersections in this sample.
        let targetRay = new Ray(targetRayPose.transform);
        let cursorDistance = 2.0;
        let cursorPos = vec3.fromValues(
            targetRay.origin.x,
            targetRay.origin.y,
            targetRay.origin.z
        );
        vec3.add(cursorPos, cursorPos, [
            targetRay.direction.x * cursorDistance,
            targetRay.direction.y * cursorDistance,
            targetRay.direction.z * cursorDistance,
        ]);
        // vec3.transformMat4(cursorPos, cursorPos, inputPose.targetRay.transformMatrix);

        scene.inputRenderer.addCursor(cursorPos);

        if (inputSource.gripSpace) {
            let gripPose = frame.getPose(inputSource.gripSpace, refSpace);
            if (gripPose) {
                // If we have a grip pose use it to render a mesh showing the
                // position of the controller.
                scene.inputRenderer.addController(gripPose.transform.matrix, inputSource.handedness); // let controller = this._controllers[handedness]; // so it is updating actually
                // TODO: ZH: update location
                if (inputSource.handedness == "left")
                    window.avatars[window.playerid].leftController.position = gripPose.transform.matrix.getTranslation();
                else if (inputSource.handedness == "right")
                    window.avatars[window.playerid].rightController.position = gripPose.transform.matrix.getTranslation();
            }
        }
        let headPose = frame.getViewerPose(refSpace);
        window.avatars[window.playerid].headset.position = headPose.matrix.getTranslation();
        // TODO: send to websocket server for sync
    }
}

function hitTest(inputSource, frame, refSpace) {
    let targetRayPose = frame.getPose(inputSource.targetRaySpace, refSpace);
    if (!targetRayPose) {
        return;
    }

    let hitResult = scene.hitTest(targetRayPose.transform);
    if (hitResult) {
        for (let source of audioSources) {
            if (hitResult.node === source.node) {
                // Associate the input source with the audio source object until
                // onSelectEnd event is raised with the same input source.
                source.draggingInput = inputSource;
                source.draggingTransform = mat4.create();
                mat4.invert(source.draggingTransform, targetRayPose.transform.matrix);
                mat4.multiply(source.draggingTransform, source.draggingTransform, source.node.matrix);
                return true;
            }
        }
    }

    return false;
}

function onSelectStart(ev) {
    let refSpace = ev.frame.session.isImmersive ?
        xrImmersiveRefSpace :
        inlineViewerHelper.referenceSpace;
    hitTest(ev.inputSource, ev.frame, refSpace);
}

// Remove any references to the input source from the audio sources so
// that the objects are not dragged any further after the user releases
// the trigger.
function onSelectEnd(ev) {
    for (let source of audioSources) {
        if (source.draggingInput === ev.inputSource) {
            source.draggingInput = undefined;
            source.draggingTransform = undefined;
        }
    }
}

let tmpMatrix = mat4.create();
function onXRFrame(t, frame) {
    let session = frame.session;
    let refSpace = session.isImmersive ?
        xrImmersiveRefSpace :
        inlineViewerHelper.referenceSpace;
    let pose = frame.getViewerPose(refSpace);

    scene.startFrame();

    session.requestAnimationFrame(onXRFrame);

    updateInputSources(session, frame, refSpace);

    // Update the position of all currently selected audio sources. It's
    // possible to select multiple audio sources and drag them at the same
    // time (one per controller that has the trigger held down).
    for (let source of audioSources) {
        if (source.draggingInput) {
            let draggingPose = frame.getPose(source.draggingInput.targetRaySpace, refSpace);
            if (draggingPose) {
                let pos = source.position;
                mat4.multiply(tmpMatrix, draggingPose.transform.matrix, source.draggingTransform);
                vec3.transformMat4(pos, [0, 0, 0], tmpMatrix);
                source.source.setPosition(pos[0], pos[1], pos[2]);
            }
        }
    }

    updateAudioNodes();

    // TODO: ZH: add scene nodes to scene for other avatars

    scene.drawXRFrame(frame, pose);

    if (pose) {
        resonance.setListenerFromMatrix({ elements: pose.transform.matrix });
    }

    scene.endFrame();
}

// Start the XR application.
initXR();