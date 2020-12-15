import { WebXRButton } from './util/webxr-button.js';
import { Scene } from './render/scenes/scene.js';
import { Renderer, createWebGLContext } from './render/core/renderer.js';
import { Gltf2Node } from './render/nodes/gltf2.js';
import { mat4, vec3 } from './render/math/gl-matrix.js';
import { Ray } from './render/math/ray.js';
import { InlineViewerHelper } from './util/inline-viewer-helper.js';
import { QueryArgs } from './util/query-args.js';
import { EventBus } from "./primitive/eventbus.js";
import * as DefaultSystemEvents from "./primitive/event.js";
import { loadAudioSources, updateAudioSources, updateAudioNodes, stereo, resonance, audioSources } from './util/positional-audio.js'

// If requested, use the polyfill to provide support for mobile devices
// and devices which only support WebVR.
import WebXRPolyfill from './third-party/webxr-polyfill/build/webxr-polyfill.module.js';
if (QueryArgs.getBool('usePolyfill', true)) {
    let polyfill = new WebXRPolyfill();
}

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

scene.addNode(stereo);

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
        loadAudioSources(scene);

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
                if(window.playerid){
                    if (inputSource.handedness == "left")
                    window.avatars[window.playerid].leftController.position = gripPose.transform.matrix.getTranslation();
                else if (inputSource.handedness == "right")
                    window.avatars[window.playerid].rightController.position = gripPose.transform.matrix.getTranslation();
                }                
            }
        }
        let headPose = frame.getViewerPose(refSpace);
        if(window.playerid)
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

    updateAudioSources();
    // Update the position of all currently selected audio sources. It's
    // possible to select multiple audio sources and drag them at the same
    // time (one per controller that has the trigger held down).    

    updateAudioNodes(scene);

    // TODO: ZH: add scene nodes to scene for other avatars

    scene.drawXRFrame(frame, pose);

    if (pose) {
        resonance.setListenerFromMatrix({ elements: pose.transform.matrix });
    }

    scene.endFrame();
}

// Start the XR application.
initXR();