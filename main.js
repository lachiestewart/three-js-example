import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';

let axes, scene, camera, renderer, loader, light, raycaster, plantModel, cubeModel, pointer, controls, gltfExporter, objExporter;

const container = document.getElementById('container');
const infoBox = document.getElementById('info-box');
const downloadGLTFButton = document.getElementById('download-gltf');
const downloadOBJButton = document.getElementById('download-obj');
const FOV = 75;

const GRID_SIZE = 7;
const TILE_SIZE = 10;
const MIN_CAMERA_DIST = TILE_SIZE / 2;
const MAX_CAMERA_DIST = GRID_SIZE * TILE_SIZE;

// link used to download the file
const link = document.createElement('a');
link.style.display = 'none';
document.body.appendChild(link);


// Initialises main components of the scene
const init = () => {
    scene = new THREE.Scene();
    // axes = new THREE.AxesHelper(2);
    // axes.name = 'axes';
    // scene.add(axes);

    camera = new THREE.PerspectiveCamera(FOV, container.clientWidth / container.clientHeight);
    camera.position.set(5, 5, 5);
    camera.lookAt(scene.position);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // Prevent camera from going below the ground
    controls.maxPolarAngle = Math.PI / 2 - 0.1;
    // Prevent camera from going too far away or too close
    controls.minDistance = MIN_CAMERA_DIST;
    controls.maxDistance = MAX_CAMERA_DIST;
    controls.minTargetRadius = MIN_CAMERA_DIST;
    controls.maxTargetRadius = MAX_CAMERA_DIST;

    // Attempting to try and stop camera from going too far away
    controls.addEventListener('change', () => {
        if (camera.position.y < 0.1) {
            console.log('Camera too low');
            controls.enableDamping = false;
            camera.position.y = 0.2;
            camera.lookAt(scene.position);
            camera.updateProjectionMatrix();
            controls.enableDamping = true;
        }
    });

    loader = new GLTFLoader();
    raycaster = new THREE.Raycaster();
    pointer = null;

    gltfExporter = new GLTFExporter();
    objExporter = new OBJExporter();
}

const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

// Fragment shader
const fragmentShader = `
    uniform sampler2D uTexture;
    uniform float uHue;
    uniform float uSaturation;
    uniform vec3 uBaseColor;

    varying vec2 vUv;

    vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs((q.z + (q.w - q.y) / (6.0 * d + e))), d / (q.x + e), q.x);
    }

    vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
        vec4 color = texture2D(uTexture, vUv);
        vec3 hsv = rgb2hsv(color.rgb);

        // Adjust the hue and saturation
        hsv.x += uHue;  // Adjust hue
        hsv.y *= uSaturation; // Adjust saturation

        // Wrap hue within 0.0 - 1.0
        if (hsv.x > 1.0) hsv.x -= 1.0;
        if (hsv.x < 0.0) hsv.x += 1.0;

        // Apply the base color
        vec3 rgb = hsv2rgb(hsv) * uBaseColor;
        
        gl_FragColor = vec4(rgb, color.a);
    }
`;

// Loads a model from a url and gives it a name
const loadModel = async (path, name) => {
    const loader = new GLTFLoader(); // Assuming GLTF format
    const model = await loader.loadAsync(path);
    model.scene.traverse((child) => {
        child.name = name;
    });
    return model.scene;
}

// Loads a plant model and scales it
const loadPlant = async (filename, position, scaleFactor = 1) => {
    const plantModel = await loadModel(`models/${filename}`, filename);
    plantModel.position.copy(position); // Set the model's position

    // Scale the model
    plantModel.scale.set(scaleFactor, scaleFactor, scaleFactor);

    scene.add(plantModel); // Add the model to the scene
}


// Load the grass texture
const loadGrassTexture = () => {
    const loader = new THREE.TextureLoader();
    return loader.load('textures/grass-tileable.jpg');
};

// Create a tile material with custom shader
const createTileMaterial = (texture, hueShift, saturation) => {
    return new THREE.ShaderMaterial({
        uniforms: {
            uTexture: { value: texture },
            uHue: { value: hueShift },  // Adjust hue
            uSaturation: { value: saturation },  // Adjust saturation
            uBaseColor: { value: new THREE.Color(0xffffff) }// Default to white, no color tint
        },
        vertexShader: vertexShader,
        fragmentShader: fragmentShader
    });
};

// Create the tile mesh
const createTile = (texture, size, hueShift, saturation) => {
    const geometry = new THREE.PlaneGeometry(size, size);
    const material = createTileMaterial(texture, hueShift, saturation);
    const tile = new THREE.Mesh(geometry, material);
    tile.rotation.x = -Math.PI / 2; // Rotate to horizontal
    return tile;
};

// Create the grid of tiles
const createTileGrid = async (rows, cols, tileSize, texture, hueShift, saturation) => {
    const grid = new THREE.Group();
    const offset = (rows - 1) * tileSize / 2; // Center the grid
    const plantPromises = [];

    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            const tile = createTile(texture, tileSize, hueShift, saturation);
            tile.position.set(i * tileSize - offset, 0, j * tileSize - offset);
            grid.add(tile);

            // Load and position the plant at the center of the tile
            // const plantPosition = new THREE.Vector3(i * tileSize - offset, 0, j * tileSize - offset);
            // const plantModel = await loadPlant('fern.glb', plantPosition, 10);

            // Adjust the plant's position above the tile if necessary
            // plantModel.position.y += tileSize / 2;

            // grid.add(plantModel);
            // plantPromises.push(
            //     loadPlant(plantFilename, plantPosition, plantScale)
            //         .then(plantModel => {
            //             // Adjust the plant's position above the tile if necessary
            //             plantModel.position.y += tileSize / 2;
            //             grid.add(plantModel);
            //         })
            // );
        }
    }
    // await Promise.all(plantPromises);
    return grid;
};

// Loads a basic cube model
const loadCube = () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshPhongMaterial({ color: 'tan', shininess: 10 })
    cubeModel = new THREE.Mesh(geometry, material);
    cubeModel.name = 'cube';
    scene.add(cubeModel);
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

    if (pointer) {
        const intersects = getIntersects();
        let text = '';
        if (intersects.length > 0) {
            text = intersects[0].object.name;
        }
        infoBox.innerText = text;
    }

    renderer.render(scene, camera);
}

const loadHDRI = (url) => {
    const loader = new EXRLoader();
    loader.load(
        url,
        texture => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            scene.background = texture;
            scene.environment = texture;
        },
        undefined,
        error => console.error('An error occurred while loading the EXR file:', error)
    );
};

init();

addLight();

const grassTexture = loadGrassTexture();
createTileGrid(GRID_SIZE, GRID_SIZE, TILE_SIZE, grassTexture, 0.2, 1.56)
    .then(grid => {
        scene.add(grid); // Add the grid with plants to the scene
    });

loadPlant('fiddle_leaf_plant.glb', new THREE.Vector3(0, 0, 10));

loadPlant('banana_plant_with_pot.glb', new THREE.Vector3(0, 0, -10));

loadPlant('fern.glb', new THREE.Vector3(0, 0, 0), 10);

// loadCube();

loadHDRI('textures/skybox.exr');

renderer.setAnimationLoop(animate);

// Updates the pointer position
const updatePointer = (event) => {
    if (!pointer) {
        pointer = new THREE.Vector2();
    }
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
    pointer = null;
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
    // const intersects = getIntersects();
    // if (intersects.length > 0) {
    //     const object = intersects[0].object;
    //     if (object.material.uniforms && object.material.uniforms.uBaseColor) {
    //         object.material.uniforms.uBaseColor.value = new THREE.Color(Math.random() * 0xffffff);
    //     }
    // }
}

// Move the camera in the direction of the arrow keys
const onKeyDown = (event) => {
    if (!pointer) {
        return;
    }
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    const up = new THREE.Vector3(0, 1, 0);
    const movementScalar = 0.5;
    switch (event.key) {
        case 'ArrowLeft':
            event.preventDefault();
            camera.position.add(cameraDirection.cross(up).normalize().multiplyScalar(-movementScalar));
            break;
        case 'ArrowRight':
            event.preventDefault();
            camera.position.add(cameraDirection.cross(up).normalize().multiplyScalar(movementScalar));
            break;
        case 'ArrowUp':
            event.preventDefault();
            camera.position.y += movementScalar;
            break;
        case 'ArrowDown':
            event.preventDefault();
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
            saveString(objExporter.parse(scene), 'scene.obj');
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