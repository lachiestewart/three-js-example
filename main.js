import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

let axes, scene, camera, renderer, loader, light, raycaster, plantModel, cubeModel, pointer, controls;

const container = document.getElementById('container');
const infoBox = document.getElementById('info-box');
const FOV = 75;

const init = () => {
    scene = new THREE.Scene();
    axes = new THREE.AxesHelper(2);
    axes.name = 'axes';
    scene.add(axes);

    camera = new THREE.PerspectiveCamera(FOV, container.clientWidth / container.clientHeight);
    camera.position.set(5, 5, 5);
    camera.lookAt(scene.position);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    loader = new GLTFLoader();
    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
}

const loadCube = () => {
    const geometry = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    const material = new THREE.MeshPhongMaterial({ color: 'tan', shininess: 10 })
    cubeModel = new THREE.Mesh(geometry, material);
    cubeModel.name = 'cube';
    scene.add(cubeModel);
}

const loadModel = (url, name) => {
    const group = new THREE.Group();
    loader.load(url, gltf => {
        const model = gltf.scene;
        // model is rendered as a child of the group, get first child and rename it
        model.children[0].name = name;
        group.add(model);
    });
    return group;
}

const loadPlant = () => {
    plantModel = loadModel('models/fiddle_leaf_plant.glb', 'plant');
    plantModel.name = 'plant';
    scene.add(plantModel);
}

const addLight = () => {
    light = new THREE.AmbientLight(0xffffff);
    scene.add(light);
}

const getIntersects = () => {
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(scene.children);
}

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

loadPlant();

loadCube();

renderer.setAnimationLoop(animate);

const updatePointer = (event) => {
    const bounds = container.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.x) / container.clientWidth) * 2 - 1;
    pointer.y = - ((event.clientY - bounds.y) / container.clientHeight) * 2 + 1;
}

const onWindowResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

const onClick = (event) => {
    updatePointer(event);
    const intersects = getIntersects();
    if (intersects.length > 0) {
        const object = intersects[0].object;
        object.material.color.set(Math.random() * 0xffffff);
    }
}


window.addEventListener('resize', onWindowResize);
window.addEventListener('load', updatePointer);
container.addEventListener('mousemove', updatePointer);
container.addEventListener('click', onClick);

console.log(scene.children);