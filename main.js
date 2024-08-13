import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

let axes, scene, camera, renderer, loader, light, raycaster, plantModel, cubeModel, pointer, controls, gltfExporter, objExporter;

const container = document.getElementById('container');
const infoBox = document.getElementById('info-box');
const downloadGLTFButton = document.getElementById('download-gltf');
const downloadOBJButton = document.getElementById('download-obj');
const FOV = 75;

// link used to download the file
const link = document.createElement('a');
link.style.display = 'none';
document.body.appendChild(link);

// Initialises main components of the scene
const init = () => {
    scene = new THREE.Scene();
    axes = new THREE.AxesHelper(2);
    axes.name = 'axes';
    scene.add(axes);

    camera = new THREE.PerspectiveCamera(FOV, container.clientWidth / container.clientHeight);
    camera.position.set(5, 5, 5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    loader = new GLTFLoader();
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    gltfExporter = new GLTFExporter();
    objExporter = new OBJExporter();
}

// Loads a basic cube model
const loadCube = () => {
    const geometry = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    const material = new THREE.MeshPhongMaterial({ color: 'tan', shininess: 10 })
    cubeModel = new THREE.Mesh(geometry, material);
    cubeModel.name = 'cube';
    scene.add(cubeModel);
}

// Loads a model from a url and gives it a name
const loadModel = (url, name) => {
    const group = new THREE.Group();
    loader.load(url, gltf => {
        const model = gltf.scene;
        // model is rendered as a child of a group, get first child and rename it
        model.children[0].name = name;
        group.add(model);
    });
    return group;
}

// Loads a plant model
const loadPlant = () => {
    plantModel = loadModel('models/fiddle_leaf_plant.glb', 'plant1');
    // plantModel.position.set(0, 0, 10);
    scene.add(plantModel);
}

// Loads a different plant model
const loadPlant2 = () => {
    plantModel = loadModel('models/banana_plant_with_pot.glb', 'plant2');
    plantModel.position.set(10, 0, 0);
    scene.add(plantModel);
}

// Adds a light to the scene
const addLight = () => {
    light = new THREE.AmbientLight(0xffffff);
    scene.add(light);
}

// Returns an array of objects that the raycaster intersects with
const getIntersects = () => {
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(scene.children, true);
}

// Method that gets called every frame
const animate = () => {

    controls.update();

    light.position.copy(camera.position);

    const intersects = getIntersects();
    let text = '';
    if (intersects.length > 0) {
        text = intersects[0].object.name;
    }
    infoBox.innerText = text;

    renderer.render(scene, camera);
}

init();

addLight();

// loadPlant();

// loadPlant2();

loadCube();

renderer.setAnimationLoop(animate);

// Updates the pointer position
const updatePointer = (event) => {
    const bounds = container.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / container.clientWidth) * 2 - 1;
    pointer.y = - ((event.clientY - bounds.top) / container.clientHeight) * 2 + 1;
}

const onMouseMove = (event) => {
    updatePointer(event);
    // stops page elements from being highlighted when double clicks occur on the canvas
    document.body.style.userSelect = 'none';
}

// Resets the user selection to default, allows things to be highlighted again
const onMouseOut = () => {
    document.body.style.userSelect = 'auto';
}

// Resize the renderer and fixes camera perspective when the window is resized
const onWindowResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// Change the color of the object that is clicked
const onClick = (event) => {
    updatePointer(event);
    const intersects = getIntersects();
    if (intersects.length > 0) {
        const object = intersects[0].object;
        object.material.color.set(Math.random() * 0xffffff);
    }
}

// Move the camera in the direction of the arrow keys
const onKeyDown = (event) => {
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    const up = new THREE.Vector3(0, 1, 0);
    const movementScalar = 0.5;
    switch (event.key) {
        case 'ArrowLeft':
            camera.position.add(cameraDirection.cross(up).normalize().multiplyScalar(-movementScalar));
            break;
        case 'ArrowRight':
            camera.position.add(cameraDirection.cross(up).normalize().multiplyScalar(movementScalar));
            break;
        case 'ArrowUp':
            camera.position.y += movementScalar;
            break;
        case 'ArrowDown':
            camera.position.y -= movementScalar;
            break;
        default:
            break;
    }
    camera.updateProjectionMatrix();
}

const save = (blob, filename) => {
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

const saveString = (text, filename) => {
    save(new Blob([text], { type: 'text/plain' }), filename);
}


const saveArrayBuffer = (buffer, filename) => {
    save(new Blob([buffer], { type: 'application/octet-stream' }), filename);
}

const onDownloadButtonClick = (fileType) => {
    switch (fileType) {
        case 'gltf':
            gltfExporter.parse(
                scene,
                result => {
                    if (result instanceof ArrayBuffer) {
                        saveArrayBuffer(result, 'scene.glb');
                    } else {
                        const output = JSON.stringify(result, null, 2);
                        saveString(output, 'scene.gltf');
                    }
                },
                error => console.log('An error happened while saving the scene')
            );
            break;
        case 'obj':
            const data = objExporter.parse(scene);
            saveString(data, 'scene.obj');
            break;
        default:
            break;
    }
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('resize', onWindowResize);
window.addEventListener('load', updatePointer);
container.addEventListener('mousemove', onMouseMove);
container.addEventListener('mouseout', onMouseOut);
container.addEventListener('click', onClick);
downloadGLTFButton.addEventListener('click', () => onDownloadButtonClick('gltf'));
downloadOBJButton.addEventListener('click', () => onDownloadButtonClick('obj'));

console.log(scene.children);
