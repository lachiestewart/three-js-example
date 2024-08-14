import * as THREE from 'three';

// Code adapted from base OrbitControls.js by three.js authors
// Found here: https://github.com/mrdoob/three.js/blob/master/examples/jsm/controls/OrbitControls.js
//
//    Basic Controls:
//    Orbit - left mouse / touch: one-finger move, or arrow keys + shiftKey
//    Zoom - middle mouse, or mousewheel / touch: two-finger spread or squish
//    Pan - right mouse, or left mouse + shiftKey, or arrow keys / touch: two-finger move
//
// Prevented camera target from going below ground level

const _changeEvent = { type: 'change' };
const _startEvent = { type: 'start' };
const _endEvent = { type: 'end' };

const TWO_PI = 2 * Math.PI;

const KEYS = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };
const MOUSE_BUTTONS = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
const TOUCHES = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

const EPS = 0.000001;

const MIN_TARGET_HEIGHT = 0.1;

const STATE = {
    NONE: - 1,
    ROTATE: 0,
    DOLLY: 1,
    PAN: 2,
    TOUCH_ROTATE: 3,
    TOUCH_PAN: 4,
    TOUCH_DOLLY_PAN: 5,
    TOUCH_DOLLY_ROTATE: 6
};

class OrbitControls extends THREE.EventDispatcher {

    constructor(camera, domElement) {

        super();

        this.camera = camera;
        this.domElement = domElement;
        this.domElement.style.touchAction = 'none'; // disable touch scroll

        // "target" sets the location of focus, where the camera orbits around
        this.target = new THREE.Vector3();

        // Sets the 3D cursor (similar to Blender), from which the maxTargetRadius takes effect
        this.cursor = new THREE.Vector3();

        // How far you can dolly in and out
        this.minDistance = 0;
        this.maxDistance = Infinity;

        // Limit camera target within a spherical area around the cursor
        this.minTargetRadius = 0;
        this.maxTargetRadius = Infinity;

        // How far you can orbit vertically, upper and lower limits.
        // Range is 0 to Math.PI radians.
        this.minPolarAngle = 0; // radians
        this.maxPolarAngle = Math.PI; // radians

        // How far you can orbit horizontally, upper and lower limits.
        // If set, the interval [ min, max ] must be a sub-interval of [ - 2 PI, 2 PI ], with ( max - min < 2 PI )
        this.minAzimuthAngle = - Infinity; // radians
        this.maxAzimuthAngle = Infinity; // radians

        this.zoomSpeed = 1.0;
        this.rotateSpeed = 1.0;
        this.panSpeed = 1.0;
        this.keyPanSpeed = 7.0;	// pixels moved per arrow key push

        //
        // public methods
        //

        this.getPolarAngle = () => spherical.phi;

        this.getAzimuthalAngle = () => spherical.theta;

        this.getDistance = () => this.camera.position.distanceTo(this.target);

        //
        // internals
        //

        let state = STATE.NONE;

        // current position in spherical coordinates
        const spherical = new THREE.Spherical();
        const sphericalDelta = new THREE.Spherical();

        let scale = 1;
        const panOffset = new THREE.Vector3();

        const rotateStart = new THREE.Vector2();
        const rotateEnd = new THREE.Vector2();
        const rotateDelta = new THREE.Vector2();

        const panStart = new THREE.Vector2();
        const panEnd = new THREE.Vector2();
        const panDelta = new THREE.Vector2();

        const dollyStart = new THREE.Vector2();
        const dollyEnd = new THREE.Vector2();
        const dollyDelta = new THREE.Vector2();

        const pointers = [];
        const pointerPositions = {};

        let controlActive = false;

        const update = () => {
            const offset = new THREE.Vector3();

            // so camera.up is the orbit axis
            const quat = new THREE.Quaternion().setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
            const quatInverse = quat.clone().invert();

            const lastPosition = new THREE.Vector3();
            const lastQuaternion = new THREE.Quaternion();
            const lastTargetPosition = new THREE.Vector3();

            const position = this.camera.position;

            offset.copy(position).sub(this.target);

            // rotate offset to "y-axis-is-up" space
            offset.applyQuaternion(quat);

            // angle from z-axis around y-axis
            spherical.setFromVector3(offset);

            spherical.theta += sphericalDelta.theta;
            spherical.phi += sphericalDelta.phi;

            // restrict theta to be between desired limits
            let min = this.minAzimuthAngle;
            let max = this.maxAzimuthAngle;

            if (isFinite(min) && isFinite(max)) {
                if (min < - Math.PI) min += TWO_PI; else if (min > Math.PI) min -= TWO_PI;
                if (max < - Math.PI) max += TWO_PI; else if (max > Math.PI) max -= TWO_PI;
                if (min <= max) {
                    spherical.theta = Math.max(min, Math.min(max, spherical.theta));
                } else {
                    spherical.theta = (spherical.theta > (min + max) / 2) ?
                        Math.max(min, spherical.theta) :
                        Math.min(max, spherical.theta);
                }
            }

            // restrict phi to be between desired limits
            spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, spherical.phi));

            spherical.makeSafe();

            // move target to panned location
            this.target.add(panOffset);

            // Limit the target distance from the cursor to create a sphere around the center of interest
            this.target.sub(this.cursor);
            this.target.clampLength(this.minTargetRadius, this.maxTargetRadius);
            this.target.add(this.cursor);
            // prevent camera from going below ground
            this.target.y = Math.max(this.target.y, MIN_TARGET_HEIGHT);

            const prevRadius = spherical.radius;
            spherical.radius = clampDistance(spherical.radius * scale);

            offset.setFromSpherical(spherical);

            // rotate offset back to "camera-up-vector-is-up" space
            offset.applyQuaternion(quatInverse);

            position.copy(this.target).add(offset);

            this.camera.lookAt(this.target);

            sphericalDelta.set(0, 0, 0);

            panOffset.set(0, 0, 0);

            scale = 1;
            // update condition is:
            // min(camera displacement, camera rotation in radians)^2 > EPS
            // using small-angle approximation cos(x/2) = 1 - x^2 / 8
            if (prevRadius != spherical.radius ||
                lastPosition.distanceToSquared(this.camera.position) > EPS ||
                8 * (1 - lastQuaternion.dot(this.camera.quaternion)) > EPS ||
                lastTargetPosition.distanceToSquared(this.target) > EPS) {
                lastPosition.copy(this.camera.position);
                lastQuaternion.copy(this.camera.quaternion);
                lastTargetPosition.copy(this.target);
                this.dispatchEvent(_changeEvent);
            }
        };

        const getZoomScale = (delta) => Math.pow(0.95, this.zoomSpeed * Math.abs(delta * 0.01));

        const rotateLeft = (angle) => sphericalDelta.theta -= angle;

        const rotateUp = (angle) => sphericalDelta.phi -= angle;

        const panLeft = (distance, cameraMatrix) => {
            const v = new THREE.Vector3();
            v.setFromMatrixColumn(cameraMatrix, 0); // Get X column of cameraMatrix
            v.multiplyScalar(-distance);
            panOffset.add(v);
        }

        const panUp = (distance, cameraMatrix) => {
            const v = new THREE.Vector3();
            v.setFromMatrixColumn(cameraMatrix, 1); // Get Y column of cameraMatrix
            v.multiplyScalar(distance);
            panOffset.add(v);
        }

        const pan = (deltaX, deltaY) => {
            const position = this.camera.position;
            const offset = new THREE.Vector3().copy(position).sub(this.target);
            let targetDistance = offset.length();
            // half of the fov is center to top of screen
            targetDistance *= Math.tan((this.camera.fov / 2) * Math.PI / 180.0);
            // we use only clientHeight here so aspect ratio does not distort speed
            panLeft(2 * deltaX * targetDistance / this.domElement.clientHeight, this.camera.matrix);
            panUp(2 * deltaY * targetDistance / this.domElement.clientHeight, this.camera.matrix);
        }

        const dollyOut = (dollyScale) => scale /= dollyScale;

        const dollyIn = (dollyScale) => scale *= dollyScale;

        const clampDistance = (dist) => Math.max(this.minDistance, Math.min(this.maxDistance, dist));

        //
        // event callbacks - update the camera state
        //

        const handleMouseDownRotate = (event) => rotateStart.set(event.clientX, event.clientY);

        const handleMouseDownDolly = (event) => dollyStart.set(event.clientX, event.clientY);

        const handleMouseDownPan = (event) => panStart.set(event.clientX, event.clientY);

        const handleMouseMoveRotate = (event) => {
            rotateEnd.set(event.clientX, event.clientY);
            rotateDelta.subVectors(rotateEnd, rotateStart).multiplyScalar(this.rotateSpeed);
            rotateLeft(TWO_PI * rotateDelta.x / this.domElement.clientHeight); // yes, height
            rotateUp(TWO_PI * rotateDelta.y / this.domElement.clientHeight);
            rotateStart.copy(rotateEnd);
            update();
        }

        const handleMouseMoveDolly = (event) => {
            dollyEnd.set(event.clientX, event.clientY);
            dollyDelta.subVectors(dollyEnd, dollyStart);
            if (dollyDelta.y > 0) {
                dollyOut(getZoomScale(dollyDelta.y));
            } else if (dollyDelta.y < 0) {
                dollyIn(getZoomScale(dollyDelta.y));
            }
            dollyStart.copy(dollyEnd);
            update();
        }

        const handleMouseMovePan = (event) => {
            panEnd.set(event.clientX, event.clientY);
            panDelta.subVectors(panEnd, panStart).multiplyScalar(this.panSpeed);
            pan(panDelta.x, panDelta.y);
            panStart.copy(panEnd);
            update();
        }

        const handleMouseWheel = (event) => {
            if (event.deltaY < 0) {
                dollyIn(getZoomScale(event.deltaY));
            } else if (event.deltaY > 0) {
                dollyOut(getZoomScale(event.deltaY));
            }
            update();
        }

        const handleKeyDown = (event) => {
            let needsUpdate = false;
            switch (event.code) {
                case KEYS.UP:
                    if (event.shiftKey) {
                        rotateUp(TWO_PI * this.rotateSpeed / this.domElement.clientHeight);
                    } else {
                        pan(0, this.keyPanSpeed);
                    }
                    needsUpdate = true;
                    break;
                case KEYS.BOTTOM:
                    if (event.shiftKey) {
                        rotateUp(- TWO_PI * this.rotateSpeed / this.domElement.clientHeight);
                    } else {
                        pan(0, - this.keyPanSpeed);
                    }
                    needsUpdate = true;
                    break;
                case KEYS.LEFT:
                    if (event.shiftKey) {
                        rotateLeft(TWO_PI * this.rotateSpeed / this.domElement.clientHeight);
                    } else {
                        pan(this.keyPanSpeed, 0);
                    }
                    needsUpdate = true;
                    break;
                case KEYS.RIGHT:
                    if (event.shiftKey) {
                        rotateLeft(- TWO_PI * this.rotateSpeed / this.domElement.clientHeight);
                    } else {
                        pan(- this.keyPanSpeed, 0);
                    }
                    needsUpdate = true;
                    break;
            }
            if (needsUpdate) {
                // prevent the browser from scrolling on cursor keys
                event.preventDefault();
                update();
            }
        }

        const handleTouchStartRotate = (event) => {
            if (pointers.length === 1) {
                rotateStart.set(event.pageX, event.pageY);
            } else {
                const position = getSecondPointerPosition(event);
                const x = 0.5 * (event.pageX + position.x);
                const y = 0.5 * (event.pageY + position.y);
                rotateStart.set(x, y);
            }
        }

        const handleTouchStartPan = (event) => {
            if (pointers.length === 1) {
                panStart.set(event.pageX, event.pageY);
            } else {
                const position = getSecondPointerPosition(event);
                const x = 0.5 * (event.pageX + position.x);
                const y = 0.5 * (event.pageY + position.y);
                panStart.set(x, y);
            }
        }

        const handleTouchStartDolly = (event) => {
            const position = getSecondPointerPosition(event);
            const dx = event.pageX - position.x;
            const dy = event.pageY - position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            dollyStart.set(0, distance);
        }

        const handleTouchStartDollyPan = (event) => {
            handleTouchStartDolly(event);
            handleTouchStartPan(event);
        }

        const handleTouchStartDollyRotate = (event) => {
            handleTouchStartDolly(event);
            handleTouchStartRotate(event);
        }

        const handleTouchMoveRotate = (event) => {
            if (pointers.length == 1) {
                rotateEnd.set(event.pageX, event.pageY);
            } else {
                const position = getSecondPointerPosition(event);
                const x = 0.5 * (event.pageX + position.x);
                const y = 0.5 * (event.pageY + position.y);
                rotateEnd.set(x, y);
            }
            rotateDelta.subVectors(rotateEnd, rotateStart).multiplyScalar(this.rotateSpeed);
            const element = this.domElement;
            rotateLeft(TWO_PI * rotateDelta.x / element.clientHeight); // yes, height
            rotateUp(TWO_PI * rotateDelta.y / element.clientHeight);
            rotateStart.copy(rotateEnd);
        }

        const handleTouchMovePan = (event) => {
            if (pointers.length === 1) {
                panEnd.set(event.pageX, event.pageY);
            } else {
                const position = getSecondPointerPosition(event);
                const x = 0.5 * (event.pageX + position.x);
                const y = 0.5 * (event.pageY + position.y);
                panEnd.set(x, y);
            }
            panDelta.subVectors(panEnd, panStart).multiplyScalar(this.panSpeed);
            pan(panDelta.x, panDelta.y);
            panStart.copy(panEnd);
        }

        const handleTouchMoveDolly = (event) => {
            const position = getSecondPointerPosition(event);
            const dx = event.pageX - position.x;
            const dy = event.pageY - position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            dollyEnd.set(0, distance);
            dollyDelta.set(0, Math.pow(dollyEnd.y / dollyStart.y, this.zoomSpeed));
            dollyOut(dollyDelta.y);
            dollyStart.copy(dollyEnd);
        }

        const handleTouchMoveDollyPan = (event) => {
            handleTouchMoveDolly(event);
            handleTouchMovePan(event);
        }

        const handleTouchMoveDollyRotate = (event) => {
            handleTouchMoveDolly(event);
            handleTouchMoveRotate(event);
        }

        //
        // event handlers - FSM: listen for events and reset state
        //

        const onPointerDown = (event) => {
            if (pointers.length === 0) {
                this.domElement.setPointerCapture(event.pointerId);
                this.domElement.addEventListener('pointermove', onPointerMove);
                this.domElement.addEventListener('pointerup', onPointerUp);
            }
            if (isTrackingPointer(event)) return;
            addPointer(event);
            if (event.pointerType === 'touch') {
                onTouchStart(event);
            } else {
                onMouseDown(event);
            }
        }

        const onPointerMove = (event) => {
            if (event.pointerType === 'touch') {
                onTouchMove(event);
            } else {
                onMouseMove(event);
            }
        }

        const onPointerUp = (event) => {
            removePointer(event);
            switch (pointers.length) {
                case 0:
                    this.domElement.releasePointerCapture(event.pointerId);
                    this.domElement.removeEventListener('pointermove', onPointerMove);
                    this.domElement.removeEventListener('pointerup', onPointerUp);
                    this.dispatchEvent(_endEvent);
                    state = STATE.NONE;
                    break;
                case 1:
                    const pointerId = pointers[0];
                    const position = pointerPositions[pointerId];
                    // minimal placeholder event - allows state correction on pointer-up
                    onTouchStart({ pointerId: pointerId, pageX: position.x, pageY: position.y });
                    break;
            }
        }

        const onMouseDown = (event) => {
            let mouseAction;
            switch (event.button) {
                case 0:
                    mouseAction = MOUSE_BUTTONS.LEFT;
                    break;
                case 1:
                    mouseAction = MOUSE_BUTTONS.MIDDLE;
                    break;
                case 2:
                    mouseAction = MOUSE_BUTTONS.RIGHT;
                    break;
                default:
                    mouseAction = -1;
            }
            switch (mouseAction) {
                case THREE.MOUSE.DOLLY:
                    handleMouseDownDolly(event);
                    state = STATE.DOLLY;
                    break;
                case THREE.MOUSE.ROTATE:
                    if (event.shiftKey) {
                        handleMouseDownPan(event);
                        state = STATE.PAN;
                    } else {
                        handleMouseDownRotate(event);
                        state = STATE.ROTATE;
                    }
                    break;
                case THREE.MOUSE.PAN:
                    if (event.shiftKey) {
                        handleMouseDownRotate(event);
                        state = STATE.ROTATE;
                    } else {
                        handleMouseDownPan(event);
                        state = STATE.PAN;
                    }
                    break;
                default:
                    state = STATE.NONE;
            }
            if (state !== STATE.NONE) {
                this.dispatchEvent(_startEvent);
            }
        }

        const onMouseMove = (event) => {
            switch (state) {
                case STATE.ROTATE:
                    handleMouseMoveRotate(event);
                    break;
                case STATE.DOLLY:
                    handleMouseMoveDolly(event);
                    break;
                case STATE.PAN:
                    handleMouseMovePan(event);
                    break;
            }
        }

        const onMouseWheel = (event) => {
            if (state !== STATE.NONE) return;
            event.preventDefault();
            this.dispatchEvent(_startEvent);
            // minimal wheel event altered to meet delta-zoom demand
            const newEvent = {
                clientX: event.clientX,
                clientY: event.clientY,
                deltaY: event.deltaY,
            };
            switch (event.deltaMode) {
                case 1: // LINE_MODE
                    newEvent.deltaY *= 16;
                    break;
                case 2: // PAGE_MODE
                    newEvent.deltaY *= 100;
                    break;
            }
            // detect if event was triggered by pinching
            if (event.ctrlKey && !controlActive) {
                newEvent.deltaY *= 10;
            }
            handleMouseWheel(newEvent);
            this.dispatchEvent(_endEvent);
        }

        const onKeyDown = (event) => handleKeyDown(event);

        const onTouchStart = (event) => {
            trackPointer(event);
            switch (pointers.length) {
                case 1:
                    switch (TOUCHES.ONE) {
                        case THREE.TOUCH.ROTATE:
                            handleTouchStartRotate(event);
                            state = STATE.TOUCH_ROTATE;
                            break;
                        case THREE.TOUCH.PAN:
                            handleTouchStartPan(event);
                            state = STATE.TOUCH_PAN;
                            break;
                        default:
                            state = STATE.NONE;
                    }
                    break;
                case 2:
                    switch (TOUCHES.TWO) {
                        case THREE.TOUCH.DOLLY_PAN:
                            handleTouchStartDollyPan(event);
                            state = STATE.TOUCH_DOLLY_PAN;
                            break;
                        case THREE.TOUCH.DOLLY_ROTATE:
                            handleTouchStartDollyRotate(event);
                            state = STATE.TOUCH_DOLLY_ROTATE;
                            break;
                        default:
                            state = STATE.NONE;
                    }
                    break;
                default:
                    state = STATE.NONE;
            }
            if (state !== STATE.NONE) {
                this.dispatchEvent(_startEvent);
            }
        }

        const onTouchMove = (event) => {
            trackPointer(event);
            switch (state) {
                case STATE.TOUCH_ROTATE:
                    handleTouchMoveRotate(event);
                    update();
                    break;
                case STATE.TOUCH_PAN:
                    handleTouchMovePan(event);
                    update();
                    break;
                case STATE.TOUCH_DOLLY_PAN:
                    handleTouchMoveDollyPan(event);
                    update();
                    break;
                case STATE.TOUCH_DOLLY_ROTATE:
                    handleTouchMoveDollyRotate(event);
                    update();
                    break;
                default:
                    state = STATE.NONE;
            }
        }

        const onContextMenu = (event) => event.preventDefault();

        const addPointer = (event) => pointers.push(event.pointerId);

        const removePointer = (event) => {
            delete pointerPositions[event.pointerId];
            for (let i = 0; i < pointers.length; i++) {
                if (pointers[i] == event.pointerId) {
                    pointers.splice(i, 1);
                    return;
                }
            }
        }

        const isTrackingPointer = (event) => pointers.includes(event.pointerId);

        const trackPointer = (event) => {
            let position = pointerPositions[event.pointerId];
            if (position === undefined) {
                position = new THREE.Vector2();
                pointerPositions[event.pointerId] = position;
            }
            position.set(event.pageX, event.pageY);
        }

        const getSecondPointerPosition = (event) => {
            const pointerId = (event.pointerId === pointers[0]) ? pointers[1] : pointers[0];
            return pointerPositions[pointerId];
        }

        this.domElement.addEventListener('contextmenu', onContextMenu);
        this.domElement.addEventListener('pointerdown', onPointerDown);
        this.domElement.addEventListener('pointercancel', onPointerUp);
        this.domElement.addEventListener('wheel', onMouseWheel, { passive: false });
        domElement.getRootNode().addEventListener('keydown', onKeyDown);

        update();
    }

}

export { OrbitControls };